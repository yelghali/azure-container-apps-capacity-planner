"use client";

import { useState } from "react";

type PlanType = "Consumption" | "Dedicated";
type PlanChoice = PlanType | "Mix";

type AppInput = {
  name: string;
  cpu: number;
  gpu: number;
  ram: number;
  minReplicas: number; // <-- add this
  replicas: number;
  plan?: PlanType;
};

const DEDICATED_NODE_TYPES = [
  { name: "D4", cpu: 4, ram: 16, gpu: 0 },
  { name: "D8", cpu: 8, ram: 32, gpu: 0 },
  { name: "D16", cpu: 16, ram: 64, gpu: 0 },
  { name: "D32", cpu: 32, ram: 128, gpu: 0 },
  { name: "E4", cpu: 4, ram: 32, gpu: 0 },
  { name: "E8", cpu: 8, ram: 64, gpu: 0 },
  { name: "E16", cpu: 16, ram: 128, gpu: 0 },
  { name: "E32", cpu: 32, ram: 256, gpu: 0 },
  { name: "NC24-A100", cpu: 24, ram: 220, gpu: 1 },
  { name: "NC48-A100", cpu: 48, ram: 440, gpu: 2 },
  { name: "NC96-A100", cpu: 96, ram: 880, gpu: 4 },
];

function getAvailableIPs(subnet: string): number | null {
  let bits: number | null = null;
  if (subnet.startsWith("/")) {
    bits = parseInt(subnet.slice(1), 10);
  } else if (/^\d+$/.test(subnet)) {
    bits = parseInt(subnet, 10);
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(subnet)) {
    const parts = subnet.split(".").map(Number);
    const bin = parts.map((n) => n.toString(2).padStart(8, "0")).join("");
    bits = bin.split("1").length - 1;
  }
  if (bits && bits >= 0 && bits <= 32) {
    const total = Math.pow(2, 32 - bits);
    return total - 14;
  }
  return null;
}

// New: For each app, assign a fixed node SKU and pack its replicas
function getPerAppDedicatedNodes(apps: AppInput[], useMinReplicas = false) {
  type NodeType = typeof DEDICATED_NODE_TYPES[number];
  type PerAppResult = {
    appName: string;
    nodeType: NodeType | null;
    nodeTypeName: string;
    replicas: number;
    nodesNeeded: number;
    perNodeCapacity: number;
    plan: string;
    minReplicas: number;
  };
  const perApp: PerAppResult[] = [];
  let totalNodes = 0;
  let warning: string | undefined;

  for (const app of apps) {
    const replicas = useMinReplicas ? app.minReplicas : app.replicas;
    // Find smallest node type that fits a single replica
    const nodeType = DEDICATED_NODE_TYPES.find(
      n => n.cpu >= app.cpu && n.ram >= app.ram && n.gpu >= app.gpu
    );
    if (!nodeType) {
      perApp.push({
        appName: app.name || "(unnamed)",
        nodeType: null,
        nodeTypeName: "N/A",
        replicas,
        nodesNeeded: 0,
        perNodeCapacity: 0,
        plan: "Dedicated (N/A)",
        minReplicas: app.minReplicas,
      });
      warning = "No suitable node type found for one or more apps.";
      continue;
    }
    // How many replicas fit on one node of this type?
    const perNodeCapacity = Math.min(
      Math.floor(nodeType.cpu / app.cpu),
      Math.floor(nodeType.ram / app.ram),
      app.gpu > 0 ? Math.floor(nodeType.gpu / app.gpu) : Infinity
    );
    const nodesNeeded = perNodeCapacity > 0 ? Math.ceil(replicas / perNodeCapacity) : 0;
    totalNodes += nodesNeeded;
    perApp.push({
      appName: app.name || "(unnamed)",
      nodeType,
      nodeTypeName: nodeType.name,
      replicas,
      nodesNeeded,
      perNodeCapacity,
      plan: `Dedicated (${nodeType.name})`,
      minReplicas: app.minReplicas,
    });
  }
  return { perApp, totalNodes, warning };
}

// Add this function before Home()
function validateAppInput(app: AppInput, planChoice: PlanChoice): string | null {
  // Only validate for Consumption plan (either global or per-app in Mix)
  const isConsumption =
    planChoice === "Consumption" ||
    (planChoice === "Mix" && app.plan === "Consumption");
  if (isConsumption) {
    if (app.cpu > 4) return "CPU must not exceed 4 for Consumption plan.";
    if (app.ram > 8) return "RAM must not exceed 8GB for Consumption plan.";
    if (app.gpu > 0) return "GPU is not supported for Consumption plan.";
  }
  return null;
}

function getAppNodeAssignments(
  assignment: { node: number; apps: { name: string; replicas: number }[] }[],
  nodeTypeName: string,
  multiplier: number = 1
): Record<string, string> {
  // Map app name to a list of node assignments (with node number and type)
  const appNodeMap: Record<string, string[]> = {};
  assignment.forEach((node) => {
    node.apps.forEach((a) => {
      const appName = a.name;
      if (!appNodeMap[appName]) appNodeMap[appName] = [];
      // Repeat node assignment for each replica (multiplied for temp/doubled)
      for (let i = 0; i < a.replicas * multiplier; i++) {
        appNodeMap[appName].push(`Node ${node.node} (${nodeTypeName})`);
      }
    });
  });
  // Join node assignments for display
  const result: Record<string, string> = {};
  Object.entries(appNodeMap).forEach(([app, nodes]) => {
    result[app] = nodes.join(", ");
  });
  return result;
}

export default function Home() {
  const [apps, setApps] = useState<AppInput[]>([
    { name: "", cpu: 0, gpu: 0, ram: 0, minReplicas: 1, replicas: 1, plan: "Consumption" },
  ]);
  const [subnetSize, setSubnetSize] = useState("");
  const [planChoice, setPlanChoice] = useState<PlanChoice>("Consumption");
  const [result, setResult] = useState<any>(null);
  const [showNodeInfo, setShowNodeInfo] = useState(false);
  const [inputErrors, setInputErrors] = useState<string[]>([]);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  const availableIPs = getAvailableIPs(subnetSize);

  function calculate(apps: AppInput[], subnet: string, planChoice: PlanChoice) {
    let warning = "";
    let bits: number | null = null;
    if (subnet.startsWith("/")) bits = parseInt(subnet.slice(1), 10);
    else if (/^\d+$/.test(subnet)) bits = parseInt(subnet, 10);
    if (bits !== null && bits > 27) {
      warning = "Minimum subnet size for integration is /27!";
    }

    let appAssignments: any[] = [];
    let details = "";

    // Calculate doubled IPs based on minReplicas
    const totalMinReplicas = apps.reduce((sum, app) => sum + (app.minReplicas || 1), 0);

    if (planChoice === "Mix") {
      const consApps = apps.filter(a => a.plan === "Consumption");
      const dedApps = apps.filter(a => a.plan === "Dedicated");
      let consIPs = 0;
      consApps.forEach(app => {
        let ipUsed = Math.ceil(app.replicas / 10);
        consIPs += ipUsed;
        appAssignments.push({
          name: app.name || "(unnamed)",
          plan: "Consumption",
          replicas: app.replicas,
          minReplicas: app.minReplicas,
          ipUsed,
          nodeType: "-",
          nodes: "-",
        });
      });

      // Dedicated: per-app node assignment
      const dedResult = getPerAppDedicatedNodes(dedApps, false);
      dedResult.perApp.forEach(appRes => {
        appAssignments.push({
          name: appRes.appName,
          plan: appRes.plan,
          replicas: appRes.replicas,
          minReplicas: appRes.minReplicas,
          nodeType: appRes.nodeTypeName,
          nodes: appRes.nodesNeeded,
          perNodeCapacity: appRes.perNodeCapacity,
        });
      });

      const dedIPs = dedResult.totalNodes;
      const totalIPs = consIPs + dedIPs;
      // --- DETAILED DETAILS LINE ---
      const details = [
        consApps.length > 0
          ? consApps
              .map(
                a =>
                  `${a.name || "(unnamed)"}: ${Math.ceil(a.replicas / 10)} IPs (Consumption)`
              )
              .join("; ")
          : null,
        dedResult.perApp.length > 0
          ? dedResult.perApp
              .map(
                a =>
                  `${a.appName}: ${a.nodesNeeded} x ${a.nodeTypeName} (up to ${a.perNodeCapacity} per node)`
              )
              .join("; ")
          : null,
      ]
        .filter(Boolean)
        .join("; ");
      // --- END DETAILS LINE ---
      return {
        plan: "Mix",
        ips: totalIPs,
        doubledIPs:
          consApps.reduce((sum, app) => sum + Math.ceil((app.minReplicas || 1) / 10), 0) +
          getPerAppDedicatedNodes(dedApps, true).totalNodes,
        details,
        appAssignments,
        warning: warning || dedResult.warning,
        perAppDedicated: dedResult.perApp,
        minReplicas: totalMinReplicas,
      };
    } else if (planChoice === "Consumption") {
      let consIPs = 0;
      apps.forEach(app => {
        let ipUsed = Math.ceil(app.replicas / 10);
        consIPs += ipUsed;
        appAssignments.push({
          name: app.name || "(unnamed)",
          plan: "Consumption",
          replicas: app.replicas,
          minReplicas: app.minReplicas,
          ipUsed,
          nodeType: "-",
          nodes: "-",
        });
      });
      // For zero-downtime, use minReplicas for each app
      const doubledIPs = apps.reduce((sum, app) => sum + Math.ceil((app.minReplicas || 1) / 10), 0);
      return {
        plan: "Consumption",
        ips: consIPs,
        doubledIPs,
        details: `Consumption apps: ${apps.length}`,
        appAssignments,
        warning,
        minReplicas: totalMinReplicas,
      };
    } else {
      // Dedicated: per-app node assignment
      const dedResult = getPerAppDedicatedNodes(apps, false);
      dedResult.perApp.forEach(appRes => {
        appAssignments.push({
          name: appRes.appName,
          plan: appRes.plan,
          replicas: appRes.replicas,
          minReplicas: appRes.minReplicas,
          nodeType: appRes.nodeTypeName,
          nodes: appRes.nodesNeeded,
          perNodeCapacity: appRes.perNodeCapacity,
        });
      });
      // For zero-downtime, use minReplicas for each app
      return {
        plan: "Dedicated",
        ips: dedResult.totalNodes,
        doubledIPs: getPerAppDedicatedNodes(apps, true).totalNodes,
        details: dedResult.warning
          ? dedResult.warning
          : dedResult.perApp
              .map(
                a =>
                  `${a.appName}: ${a.nodesNeeded} x ${a.nodeTypeName} (up to ${a.perNodeCapacity} per node)`
              )
              .join("; "),
        appAssignments,
        warning: warning || dedResult.warning,
        perAppDedicated: dedResult.perApp,
        minReplicas: totalMinReplicas,
      };
    }
  }

  const handleAppChange = (
    idx: number,
    field: keyof AppInput,
    value: string
  ) => {
    const updated = [...apps];
    if (field === "name") {
      updated[idx][field] = value as AppInput[typeof field];
    } else if (field === "plan") {
      updated[idx][field] = value as PlanType;
    } else {
      updated[idx][field] = Number(value) as AppInput[typeof field];
    }
    setApps(updated);
  };

  const addApp = () => {
    setApps([
      ...apps,
      {
        name: "",
        cpu: 0,
        gpu: 0,
        ram: 0,
        minReplicas: 1,
        replicas: 1,
        plan: planChoice === "Mix" ? "Consumption" : undefined,
      },
    ]);
  };

  const removeApp = (idx: number) => {
    setApps(apps.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate all apps
    const errors: string[] = [];
    apps.forEach((app, idx) => {
      const err = validateAppInput(app, planChoice);
      if (err) errors.push(`App ${app.name || idx + 1}: ${err}`);
    });
    setInputErrors(errors);
    if (errors.length > 0) return;
    setResult(calculate(apps, subnetSize, planChoice));
  };

  const handlePlanChoiceChange = (value: PlanChoice) => {
    setPlanChoice(value);
    if (value !== "Mix") {
      setApps((prev) =>
        prev.map((app) => {
          const { plan, ...rest } = app;
          return rest;
        })
      );
    } else {
      setApps((prev) =>
        prev.map((app) => ({
          ...app,
          plan: "Consumption",
        }))
      );
    }
  };

  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto", fontFamily: "sans-serif" }}>
      {/* How it works button and modal */}
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <a
          href="https://github.com/yelghali/azure-container-apps-capacity-planner"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          style={{
            display: "inline-flex",
            alignItems: "center",
            textDecoration: "none",
            marginRight: 4,
          }}
        >
          <svg
            height="28"
            width="28"
            viewBox="0 0 16 16"
            fill="currentColor"
            style={{ color: "#24292f", display: "block" }}
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
            0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52
            -.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2
            -3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64
            -.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08
            2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01
            1.93-.01 2.19 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
        <button
          type="button"
          onClick={() => setShowHowItWorks(true)}
          style={{
            background: "#e6f0fa",
            color: "#0078d4",
            border: "none",
            borderRadius: 6,
            padding: "8px 18px",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer"
          }}
        >
          How it works
        </button>
      </div>
      {showHowItWorks && (
        <div
          style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.25)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 10,
              maxWidth: 540,
              width: "90%",
              padding: 28,
              boxShadow: "0 4px 24px #0003",
              position: "relative"
            }}
          >
            <h2 style={{ marginTop: 0 }}>How it works</h2>
            <ol style={{ fontSize: 16, marginBottom: 0 }}>
              <li>
                <strong>Network IP Calculation:</strong> Enter your subnet size (e.g. <code>/24</code>). The tool calculates available IPs as <code>2^(32 - subnet bits) - 14</code> (the <code>-14</code> accounts for reserved Azure addresses).
              </li>
              <li>
                <strong>App Requirements:</strong> For each app, specify CPU, RAM, GPU, minimum and maximum replicas, and (if using "Mix" plan) the plan type.
              </li>
              <li>
                <strong>Plan Selection:</strong> Choose between <b>Consumption</b>, <b>Dedicated</b>, or <b>Mix</b>:
                <ul>
                  <li>
                    <b>Consumption:</b> Each 10 replicas of an app require 1 IP. Resource limits: max 4 CPU, 8GB RAM, no GPU.
                  </li>
                  <li>
                    <b>Dedicated:</b> <b>Scheduling logic:</b> For each app, the tool chooses the <u>smallest dedicated node type (SKU)</u> that can fit the app’s CPU, RAM, and GPU requirements. Replicas are then packed onto as few nodes as possible, based on that node’s capacity.
                  </li>
                  <li>
                    <b>Mix:</b> Some apps use Consumption, others Dedicated, calculated as above.
                  </li>
                </ul>
              </li>
              <li>
                <strong>Capacity Planning:</strong>
                <ul>
                  <li>
                    <b>Peak Usage:</b> Uses the maximum replicas for each app to estimate required nodes and IPs.
                  </li>
                  <li>
                    <b>Zero-downtime Upgrades:</b> Assumes minimum replicas are temporarily doubled during upgrades. The tool recalculates node packing and IPs for this scenario.
                  </li>
                </ul>
              </li>
              <li>
                <strong>Results:</strong> The tool displays required IPs, node assignments, and warnings if your subnet is too small for peak or upgrade scenarios.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowHowItWorks(false)}
              style={{
                position: "absolute",
                top: 12,
                right: 16,
                background: "#0078d4",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                padding: "4px 12px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      <h1 style={{ textAlign: "center", marginBottom: 0 }}>
        Azure Container App (ACA) Capacity Planner
      </h1>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginBottom: 8 }}>
        <button
          type="button"
          aria-label="Show node capacities"
          onClick={() => setShowNodeInfo((v) => !v)}
          style={{
            background: "#e6f0fa",
            color: "#0078d4",
            border: "none",
            borderRadius: "50%",
            width: 32,
            height: 32,
            fontWeight: 700,
            fontSize: 18,
            cursor: "pointer",
            marginRight: 8,
            position: "relative",
          }}
        >
          i
        </button>
        {showNodeInfo && (
          <div
            style={{
              position: "absolute",
              top: 60,
              right: 30,
              zIndex: 10,
              background: "#fff",
              border: "1px solid #0078d4",
              borderRadius: 8,
              boxShadow: "0 2px 8px #0002",
              padding: 16,
              minWidth: 320,
            }}
          >
            <strong>Dedicated Node Types & Capacities</strong>
            <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "#e6f0fa" }}>
                  <th style={{ padding: 4, textAlign: "left" }}>Name</th>
                  <th style={{ padding: 4, textAlign: "left" }}>CPU</th>
                  <th style={{ padding: 4, textAlign: "left" }}>RAM (GB)</th>
                  <th style={{ padding: 4, textAlign: "left" }}>GPU</th>
                </tr>
              </thead>
              <tbody>
                {DEDICATED_NODE_TYPES.map((n) => (
                  <tr key={n.name}>
                    <td style={{ padding: 4 }}>{n.name}</td>
                    <td style={{ padding: 4 }}>{n.cpu}</td>
                    <td style={{ padding: 4 }}>{n.ram}</td>
                    <td style={{ padding: 4 }}>{n.gpu}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              onClick={() => setShowNodeInfo(false)}
              style={{
                marginTop: 10,
                background: "#0078d4",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                padding: "4px 12px",
                cursor: "pointer",
                float: "right",
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
      <p
        style={{
          textAlign: "center",
          color: "#222",
          marginTop: 4,
          marginBottom: 32,
        }}
      >
        Enter your subnet size and app requirements to estimate the best Azure plan and IP usage.
      </p>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: 24,
          borderRadius: 12,
          boxShadow: "0 2px 8px #0001",
        }}
      >
        <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 16 }}>
          <label style={{ fontWeight: 500, marginRight: 8 }}>
            Which plan do you want to use?
          </label>
          <label style={{ marginRight: 12 }}>
            <input
              type="radio"
              name="planChoice"
              value="Consumption"
              checked={planChoice === "Consumption"}
              onChange={() => handlePlanChoiceChange("Consumption")}
            />{" "}
            Consumption
          </label>
          <label style={{ marginRight: 12 }}>
            <input
              type="radio"
              name="planChoice"
              value="Dedicated"
              checked={planChoice === "Dedicated"}
              onChange={() => handlePlanChoiceChange("Dedicated")}
            />{" "}
            Dedicated
          </label>
          <label>
            <input
              type="radio"
              name="planChoice"
              value="Mix"
              checked={planChoice === "Mix"}
              onChange={() => handlePlanChoiceChange("Mix")}
            />{" "}
            Mix
          </label>
        </div>
        <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 16 }}>
          <label htmlFor="subnet" style={{ fontWeight: 500, marginRight: 8 }}>
            Subnet Size
          </label>
          <input
            id="subnet"
            type="text"
            placeholder="e.g. /24"
            value={subnetSize}
            onChange={(e) => setSubnetSize(e.target.value)}
            required
            style={{
              padding: 8,
              borderRadius: 4,
              border: "1px solid #ccc",
              width: 120,
            }}
          />
          <span style={{ color: "#0078d4", fontWeight: 500 }}>
            {subnetSize
              ? `Available IPs: ${
                  availableIPs !== null ? availableIPs : "-"
                }`
              : ""}
          </span>
          <span style={{ color: "#666", fontSize: 13, marginLeft: 8 }}>
            (Available IPs = 2<sup>(32 - subnet bits)</sup> - 14)
          </span>
        </div>
        <h2 style={{ marginBottom: 12 }}>Apps</h2>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: 16,
            background: "#fff",
          }}
        >
          <thead>
            <tr style={{ background: "#e6f0fa" }}>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>CPU</th>
              <th style={thStyle}>GPU</th>
              <th style={thStyle}>RAM (GB)</th>
              <th style={thStyle}>Min Replicas</th>
              <th style={thStyle}>Max Replicas</th>
              {planChoice === "Mix" && <th style={thStyle}>Plan</th>}
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app, idx) => (
              <tr key={idx}>
                <td style={tdStyle}>
                  <input
                    id={`name-${idx}`}
                    type="text"
                    value={app.name}
                    onChange={(e) =>
                      handleAppChange(idx, "name", e.target.value)
                    }
                    required
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    id={`cpu-${idx}`}
                    type="number"
                    value={app.cpu}
                    min={0}
                    step={0.1}
                    onChange={(e) =>
                      handleAppChange(idx, "cpu", e.target.value)
                    }
                    required
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    id={`gpu-${idx}`}
                    type="number"
                    value={app.gpu}
                    min={0}
                    step={1}
                    onChange={(e) =>
                      handleAppChange(idx, "gpu", e.target.value)
                    }
                    required
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    id={`ram-${idx}`}
                    type="number"
                    value={app.ram}
                    min={0}
                    step={0.1}
                    onChange={(e) =>
                      handleAppChange(idx, "ram", e.target.value)
                    }
                    required
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    id={`minReplicas-${idx}`}
                    type="number"
                    value={app.minReplicas}
                    min={1}
                    step={1}
                    onChange={(e) =>
                      handleAppChange(idx, "minReplicas", e.target.value)
                    }
                    required
                    style={inputStyle}
                  />
                </td>
                <td style={tdStyle}>
                  <input
                    id={`replicas-${idx}`}
                    type="number"
                    value={app.replicas}
                    min={1}
                    step={1}
                    onChange={(e) =>
                      handleAppChange(idx, "replicas", e.target.value)
                    }
                    required
                    style={inputStyle}
                  />
                </td>
                {planChoice === "Mix" && (
                  <td style={tdStyle}>
                    <select
                      value={app.plan}
                      onChange={(e) =>
                        handleAppChange(idx, "plan", e.target.value)
                      }
                      style={{
                        ...inputStyle,
                        minWidth: 110,
                        padding: "6px 8px",
                      }}
                    >
                      <option value="Consumption">Consumption</option>
                      <option value="Dedicated">Dedicated</option>
                    </select>
                  </td>
                )}
                <td style={tdStyle}>
                  {apps.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeApp(idx)}
                      style={{
                        background: "#ffeded",
                        color: "#c00",
                        border: "none",
                        borderRadius: 4,
                        padding: "4px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={addApp}
          style={{
            background: "#e6f0fa",
            color: "#0078d4",
            border: "none",
            borderRadius: 4,
            padding: "8px 16px",
            fontWeight: 500,
            cursor: "pointer",
            marginBottom: 16,
          }}
        >
          + Add App
        </button>
        <div>
          <button
            type="submit"
            style={{
              background: "#0078d4",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "10px 24px",
              fontWeight: 600,
              fontSize: 16,
              cursor: "pointer",
              marginTop: 8,
            }}
          >
            Calculate
          </button>
        </div>
      </form>
      {inputErrors.length > 0 && (
        <div style={{ background: "#ffeded", color: "#c00", borderRadius: 6, padding: 12, marginBottom: 16 }}>
          <strong>Input Error{inputErrors.length > 1 ? "s" : ""}:</strong>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {inputErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}
      {result && (
        <div
          style={{
            marginTop: 32,
            padding: 16,
            border: "1px solid #0078d4",
            background: "#f3f9fd",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2>Results</h2>
            <div style={{ display: "flex", gap: 10 }}>
              <a
                href="https://learn.microsoft.com/en-us/azure/container-apps/workload-profiles-overview#profile-types"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: "#0078d4",
                  color: "#fff",
                  padding: "6px 16px",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                View Azure SKUs Documentation
              </a>
              <button
                type="button"
                aria-label="Show node capacities"
                onClick={() => setShowNodeInfo((v) => !v)}
                style={{
                  background: "#e6f0fa",
                  color: "#0078d4",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 10px",
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: "pointer",
                }}
              >
                Dedicated Node Types & Capacities
              </button>
              <a
                href="https://learn.microsoft.com/en-us/azure/container-apps/custom-virtual-networks?tabs=workload-profiles-env#subnet"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: "#0078d4",
                  color: "#fff",
                  padding: "6px 16px",
                  borderRadius: 6,
                  textDecoration: "none",
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                Plan IP Addresses
              </a>
            </div>
          </div>
          {result.warning && (
            <p style={{ color: "#c00", fontWeight: 500 }}>{result.warning}</p>
          )}
          {/* Show error if available IPs is less than needed */}
          {availableIPs !== null && result.ips > availableIPs && (
            <p style={{ color: "#fff", background: "#c00", padding: 8, borderRadius: 4, fontWeight: 600 }}>
              Error: Not enough available IPs in the subnet! ({availableIPs} available, {result.ips} required)
            </p>
          )}
          {/* Show error if available IPs is less than doubled IPs */}
          {availableIPs !== null && result.doubledIPs > availableIPs && (
            <p style={{ color: "#fff", background: "#c00", padding: 8, borderRadius: 4, fontWeight: 600 }}>
              Error: Not enough available IPs for zero-downtime revision updates!<br />
              ({availableIPs} available, {result.doubledIPs} required for revision update)<br />
              <span style={{ fontWeight: 400 }}>
                Capacity planning must account for revision updates (temporary doubling of resources).
              </span>
            </p>
          )}
          <p>
            <strong>Selected Plan:</strong> {result.plan}
          </p>
          
          {/* Final Results Table */}
          <h3 style={{ marginTop: 24 }}>Planning for Peak usage (based on MaxReplicas)</h3>
          <p>
            <strong>Estimated IPs Used during peak hours:</strong> {result.ips}
          </p>
     
          {result.details && (
            <p>
              <strong>Details:</strong> {result.details}
            </p>
          )}
          <table style={{ width: "100%", marginTop: 16, background: "#fff", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#e6f0fa" }}>
                <th style={thStyle}>App Name</th>
                <th style={thStyle}>Assigned Plan</th>
                <th style={thStyle}>Replicas</th>
                <th style={thStyle}>Node(s) Assigned</th>
                <th style={thStyle}>IPs Used</th>
              </tr>
            </thead>
            <tbody>
              {result.appAssignments.map((a: any, i: number) => {
                // Calculate node assignments and IPs used for each app
                let nodesAssigned = "-";
                let ipsUsed = "-";
                if (a.nodeType !== "-" && a.nodes !== "-" && a.nodes > 0 && a.perNodeCapacity > 0) {
                  // Assign replicas to minimal number of nodes
                  const nodeAssignments: string[] = [];
                  for (let node = 1; node <= a.nodes; node++) {
                    const startReplica = (node - 1) * a.perNodeCapacity + 1;
                    let endReplica = node * a.perNodeCapacity;
                    if (endReplica > a.replicas) endReplica = a.replicas;
                    nodeAssignments.push(
                      a.replicas === 1
                        ? `Node ${node} (${a.nodeType})`
                        : `Node ${node} (${a.nodeType}): replicas ${startReplica}-${endReplica}`
                    );
                  }
                  nodesAssigned = nodeAssignments.join(", ");
                  ipsUsed = a.nodes;
                } else if (a.plan === "Consumption") {
                  ipsUsed = Math.ceil(a.replicas / 10).toString();
                }
                return (
                  <tr key={i}>
                    <td style={tdStyle}>{a.name}</td>
                    <td style={tdStyle}>{a.plan}</td>
                    <td style={tdStyle}>{a.replicas}</td>
                    <td style={tdStyle}>{nodesAssigned}</td>
                    <td style={tdStyle}>{ipsUsed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <br />
          <br />
          {/* Zero-downtime (Upgrade Phase) Results */}
          <h3 style={{ marginTop: 32 }}>Planning for Zero-downtime (Upgrade Phase) during low usage periods</h3>
          {(() => {
            // Split apps for Mix, or use all for other plans
            let consApps: AppInput[] = [];
            let dedApps: AppInput[] = [];
            if (result.plan === "Mix") {
              consApps = apps.filter(a => a.plan === "Consumption");
              dedApps = apps.filter(a => a.plan === "Dedicated");
            } else if (result.plan === "Consumption") {
              consApps = apps;
            } else if (result.plan === "Dedicated") {
              dedApps = apps;
            }

            // Consumption: IPs = ceil((minReplicas*2)/10) per app
            const consRows = consApps.map((app, i) => ({
              name: app.name || `(App ${i + 1})`,
              plan: "Consumption",
              minReplicas: app.minReplicas * 2,
              ipUsed: Math.ceil((app.minReplicas * 2) / 10),
            }));
            const consIPs = consRows.reduce((sum, row) => sum + row.ipUsed, 0);

            // Dedicated: bin-pack using doubled minReplicas
            // Create a copy of apps with doubled minReplicas for upgrade
            const dedUpgrade = getPerAppDedicatedNodes(
              dedApps.map(app => ({ ...app, minReplicas: app.minReplicas * 2 })),
              true
            );

            // Total IPs for upgrade phase
            const upgradeIPs = consIPs + (dedUpgrade.totalNodes || 0);

            return (
              <>
                             {/* Add upgrade details summary here */}
                {(consRows.length > 0 || dedUpgrade.perApp.length > 0) && (
                  <p style={{ marginTop: 8 }}>
                    <strong>Details:</strong>{" "}
                    {[
                      consRows.length > 0
                        ? consRows
                            .map(
                              row =>
                                `${row.name}: ${row.ipUsed} IPs (Consumption, ${row.minReplicas} replicas)`
                            )
                            .join("; ")
                        : null,
                      dedUpgrade.perApp.length > 0
                        ? dedUpgrade.perApp
                            .map(
                              a =>
                                `${a.appName}: ${a.nodesNeeded} x ${a.nodeTypeName} (up to ${a.perNodeCapacity} per node)`
                            )
                            .join("; ")
                        : null,
                    ]
                      .filter(Boolean)
                      .join("; ")}
                  </p>
                )}
                <p style={{ marginTop: 12 }}>
                  <strong>Estimated IPs Used During Upgrades (Zero-downtime, based on Min Replicas Doubled):</strong> {upgradeIPs}
                </p>
                <table style={{ width: "100%", marginTop: 16, background: "#fff", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#e6f0fa" }}>
                      <th style={thStyle}>App Name</th>
                      <th style={thStyle}>Assigned Plan</th>
                      <th style={thStyle}>Replicas (Min, Doubled)</th>
                      <th style={thStyle}>Node(s) Assigned (Doubled)</th>
                      <th style={thStyle}>IPs Used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Consumption rows */}
                    {consRows.map((row, i) => (
                      <tr key={`cons-${i}`}>
                        <td style={tdStyle}>{row.name}</td>
                        <td style={tdStyle}>{row.plan}</td>
                        <td style={tdStyle}>{row.minReplicas}</td>
                        <td style={tdStyle}>-</td>
                        <td style={tdStyle}>{row.ipUsed}</td>
                      </tr>
                    ))}
                    {/* Dedicated rows */}
                    {dedApps.map((app, i) => {
                      const perApp = dedUpgrade.perApp[i];
                      let nodesAssigned = "-";
                      if (perApp?.nodesNeeded > 0 && perApp?.perNodeCapacity > 0) {
                        // Assign replicas to minimal number of nodes
                        const nodeAssignments: string[] = [];
                        for (let node = 1; node <= perApp.nodesNeeded; node++) {
                          // Calculate how many replicas on this node
                          const startReplica = (node - 1) * perApp.perNodeCapacity + 1;
                          let endReplica = node * perApp.perNodeCapacity;
                          if (endReplica > perApp.replicas) endReplica = perApp.replicas;
                          nodeAssignments.push(
                            perApp.replicas === 1
                              ? `Node ${node} (${perApp.nodeTypeName})`
                              : `Node ${node} (${perApp.nodeTypeName}): replicas ${startReplica}-${endReplica}`
                          );
                        }
                        nodesAssigned = nodeAssignments.join(", ");
                      }
                      return (
                        <tr key={`ded-${i}`}>
                          <td style={tdStyle}>{app.name}</td>
                          <td style={tdStyle}>
                            {perApp?.plan || "Dedicated (N/A)"}
                          </td>
                          <td style={tdStyle}>{perApp?.replicas}</td>
                          <td style={tdStyle}>
                            {nodesAssigned}
                          </td>
                          <td style={tdStyle}>
                            {perApp?.nodesNeeded > 0 ? perApp.nodesNeeded : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
 
              </>
            );
          })()}
        </div>
      )}
      {/* ...existing code... */}
    </main>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 4px",
  borderBottom: "2px solid #b3d1f7",
  fontWeight: 600,
  textAlign: "left",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 4px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  borderRadius: 4,
  border: "1px solid #ccc",
  fontSize: 15,
  boxSizing: "border-box",
};