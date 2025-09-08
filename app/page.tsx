"use client";

import { useState } from "react";

type PlanType = "Consumption" | "Dedicated";
type PlanChoice = PlanType | "Mix";

type AppInput = {
  name: string;
  cpu: number;
  gpu: number;
  ram: number;
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

// Bin-packing for Dedicated: fill nodes with as many app replicas as possible
function packDedicatedNodes(apps: AppInput[]) {
  // Find the smallest node type that fits the largest per-replica requirements
  let maxCpu = 0, maxRam = 0, maxGpu = 0;
  apps.forEach(app => {
    maxCpu = Math.max(maxCpu, app.cpu);
    maxRam = Math.max(maxRam, app.ram);
    maxGpu = Math.max(maxGpu, app.gpu);
  });
  const nodeType = DEDICATED_NODE_TYPES.find(
    node => node.cpu >= maxCpu && node.ram >= maxRam && node.gpu >= maxGpu
  );
  if (!nodeType) return { nodeType: null, nodes: 0, assignment: [] };

  // Deep copy of app replicas
  let remaining = apps.map(app => ({ ...app }));
  let nodes = 0;
  let assignment: { node: number, apps: { name: string, replicas: number }[] }[] = [];
  while (remaining.some(app => app.replicas > 0)) {
    let nodeCpu = nodeType.cpu, nodeRam = nodeType.ram, nodeGpu = nodeType.gpu;
    let nodeApps: { name: string, replicas: number }[] = [];
    for (let i = 0; i < remaining.length; i++) {
      let app = remaining[i];
      let fit = Math.min(
        app.replicas,
        Math.floor(nodeCpu / app.cpu),
        Math.floor(nodeRam / app.ram),
        app.gpu > 0 ? Math.floor(nodeGpu / app.gpu) : Infinity
      );
      if (fit > 0) {
        nodeApps.push({ name: app.name || `(App ${i + 1})`, replicas: fit });
        nodeCpu -= fit * app.cpu;
        nodeRam -= fit * app.ram;
        nodeGpu -= fit * app.gpu;
        app.replicas -= fit;
      }
    }
    assignment.push({ node: nodes + 1, apps: nodeApps });
    nodes++;
  }
  return { nodeType, nodes, assignment };
}

function getDedicatedNodesPerApp(apps: AppInput[]): {
  nodeType: typeof DEDICATED_NODE_TYPES[number] | null,
  perAppNodes: Record<string, number>,
  nodes: number,
  assignment: { node: number, apps: { name: string, replicas: number }[] }[]
} {
  // Find the smallest node type that fits the largest per-replica requirements
  let maxCpu = 0, maxRam = 0, maxGpu = 0;
  apps.forEach(app => {
    maxCpu = Math.max(maxCpu, app.cpu);
    maxRam = Math.max(maxRam, app.ram);
    maxGpu = Math.max(maxGpu, app.gpu);
  });
  const nodeType = DEDICATED_NODE_TYPES.find(
    node => node.cpu >= maxCpu && node.ram >= maxRam && node.gpu >= maxGpu
  );
  if (!nodeType) return { nodeType: null, perAppNodes: {}, nodes: 0, assignment: [] };

  let remaining = apps.map(app => ({ ...app }));
  let nodes = 0;
  let assignment: { node: number, apps: { name: string, replicas: number }[] }[] = [];
  let perAppNodes: Record<string, number> = {};
  while (remaining.some(app => app.replicas > 0)) {
    let nodeCpu = nodeType.cpu, nodeRam = nodeType.ram, nodeGpu = nodeType.gpu;
    let nodeApps: { name: string, replicas: number }[] = [];
    for (let i = 0; i < remaining.length; i++) {
      let app = remaining[i];
      let fit = Math.min(
        app.replicas,
        Math.floor(nodeCpu / app.cpu),
        Math.floor(nodeRam / app.ram),
        app.gpu > 0 ? Math.floor(nodeGpu / app.gpu) : Infinity
      );
      if (fit > 0) {
        const appKey = app.name || `(App ${i + 1})`;
        nodeApps.push({ name: appKey, replicas: fit });
        nodeCpu -= fit * app.cpu;
        nodeRam -= fit * app.ram;
        nodeGpu -= fit * app.gpu;
        app.replicas -= fit;
        perAppNodes[appKey] = (perAppNodes[appKey] || 0) + 1;
      }
    }
    assignment.push({ node: nodes + 1, apps: nodeApps });
    nodes++;
  }
  return { nodeType, perAppNodes, nodes, assignment };
}

export default function Home() {
  const [apps, setApps] = useState<AppInput[]>([
    { name: "", cpu: 0, gpu: 0, ram: 0, replicas: 1, plan: "Consumption" },
  ]);
  const [subnetSize, setSubnetSize] = useState("");
  const [planChoice, setPlanChoice] = useState<PlanChoice>("Consumption");
  const [result, setResult] = useState<any>(null);

  const availableIPs = getAvailableIPs(subnetSize);

  function calculate(apps: AppInput[], subnet: string, planChoice: PlanChoice) {
    let warning = "";
    let bits: number | null = null;
    if (subnet.startsWith("/")) bits = parseInt(subnet.slice(1), 10);
    else if (/^\d+$/.test(subnet)) bits = parseInt(subnet, 10);
    if (bits !== null && bits < 27) {
      warning = "Minimum subnet size for integration is /27!";
    }

    let totalIPs = 14; // 14 reserved for infra
    let appAssignments: any[] = [];
    let details = "";

    if (planChoice === "Mix") {
      // Split apps by plan
      const consApps = apps.filter(a => a.plan === "Consumption");
      const dedApps = apps.filter(a => a.plan === "Dedicated");
      // Consumption
      let consIPs = 0;
      consApps.forEach(app => {
        let ipUsed = Math.ceil(app.replicas / 10);
        consIPs += ipUsed;
        appAssignments.push({
          name: app.name || "(unnamed)",
          plan: "Consumption",
          replicas: app.replicas,
          ipUsed,
          nodeType: "-",
          nodes: "-",
        });
      });
      // Dedicated
      let dedIPs = 0;
      let nodeType: typeof DEDICATED_NODE_TYPES[number] | null = null, nodes = 0, assignment: { node: number, apps: { name: string, replicas: number }[] }[] = [];
      if (dedApps.length > 0) {
        const packed = packDedicatedNodes(dedApps);
        nodeType = packed.nodeType;
        nodes = packed.nodes;
        assignment = packed.assignment;
        dedIPs = nodes;
        dedApps.forEach(app => {
          appAssignments.push({
            name: app.name || "(unnamed)",
            plan: nodeType ? `Dedicated (${nodeType.name})` : "Dedicated (N/A)",
            replicas: app.replicas,
            ipUsed: "-", // shown in node summary
            nodeType: nodeType ? nodeType.name : "-",
            nodes: nodes,
          });
        });
      }
      totalIPs += consIPs + dedIPs;
      details = `Consumption apps: ${consApps.length}, Dedicated apps: ${dedApps.length}`;
      return {
        plan: "Mix",
        ips: totalIPs,
        doubledIPs: totalIPs * 2,
        details,
        appAssignments,
        warning,
        nodeType,
        nodes,
        assignment,
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
          ipUsed,
          nodeType: "-",
          nodes: "-",
        });
      });
      totalIPs += consIPs;
      details = `Consumption apps: ${apps.length}`;
      return {
        plan: "Consumption",
        ips: totalIPs,
        doubledIPs: totalIPs * 2,
        details,
        appAssignments,
        warning,
      };
    } else {
      // Dedicated
      const packed = getDedicatedNodesPerApp(apps);
      let nodeType = packed.nodeType;
      let nodes = packed.nodes;
      let assignment = packed.assignment;
      let perAppNodes = packed.perAppNodes;
      // Map app name to list of node numbers it is assigned to
      const appNodeMap: Record<string, number[]> = {};
      assignment.forEach((node) => {
        node.apps.forEach((a) => {
          if (!appNodeMap[a.name]) appNodeMap[a.name] = [];
          appNodeMap[a.name].push(node.node);
        });
      });
      totalIPs += nodes;
      details = nodeType
        ? `Node type: ${nodeType.name}, Nodes needed: ${nodes}`
        : "No suitable node type found for app requirements.";
      apps.forEach(app => {
        const appKey = app.name || "(unnamed)";
        appAssignments.push({
          name: appKey,
          plan: nodeType ? `Dedicated (${nodeType.name})` : "Dedicated (N/A)",
          replicas: app.replicas,
          nodesAssigned: appNodeMap[appKey]?.map(n => `Node ${n} (${nodeType?.name})`).join(", ") || "-",
        });
      });
      return {
        plan: "Dedicated",
        ips: totalIPs,
        doubledIPs: totalIPs * 2,
        details,
        appAssignments,
        warning: nodeType ? undefined : "No suitable node type found for app requirements.",
        nodeType,
        nodes,
        assignment,
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
    <main style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1 style={{ textAlign: "center", marginBottom: 0 }}>
        Azure Container App Capacity Planner
      </h1>
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
              <th style={thStyle}>Max Replicas</th>
              {planChoice === "Mix" && <th style={thStyle}>Plan</th>}
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {apps.map((app, idx) => (
              <tr key={idx}>
                <td style={tdStyle}>
                  <label className="sr-only" htmlFor={`name-${idx}`}>
                    Name
                  </label>
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
                  <label className="sr-only" htmlFor={`cpu-${idx}`}>
                    CPU
                  </label>
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
                  <label className="sr-only" htmlFor={`gpu-${idx}`}>
                    GPU
                  </label>
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
                  <label className="sr-only" htmlFor={`ram-${idx}`}>
                    RAM (GB)
                  </label>
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
                  <label className="sr-only" htmlFor={`replicas-${idx}`}>
                    Max Replicas
                  </label>
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
          <h2>Results</h2>
          {result.warning && (
            <p style={{ color: "#c00", fontWeight: 500 }}>{result.warning}</p>
          )}
          {/* Show error if available IPs is less than needed */}
          {availableIPs !== null && result.ips > availableIPs && (
            <p style={{ color: "#fff", background: "#c00", padding: 8, borderRadius: 4, fontWeight: 600 }}>
              Error: Not enough available IPs in the subnet! ({availableIPs} available, {result.ips} required)
            </p>
          )}
          <p>
            <strong>Selected Plan:</strong> {result.plan}
          </p>
          <p>
            <strong>Estimated IPs Used:</strong> {result.ips}
          </p>
          <p style={{ color: "#666", fontSize: 13 }}>
            <em>
              During zero-downtime deployments (single revision mode), required IPs are temporarily doubled: <strong>{result.doubledIPs}</strong>
            </em>
          </p>
          {result.details && (
            <p>
              <strong>Details:</strong> {result.details}
            </p>
          )}
          {result.assignment && result.nodeType && (
            <div style={{ marginTop: 12 }}>
              <strong>Node Packing (Dedicated):</strong>
              <ul>
                {result.assignment.map((node: any) => (
                  <li key={node.node}>
                    Node {node.node} ({result.nodeType.name}):{" "}
                    {node.apps.map((a: any) => `${a.replicas} x ${a.name}`).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <table style={{ width: "100%", marginTop: 16, background: "#fff", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#e6f0fa" }}>
                <th style={thStyle}>App Name</th>
                <th style={thStyle}>Assigned Plan</th>
                <th style={thStyle}>Replicas</th>
                <th style={thStyle}>Node(s) Assigned</th>
              </tr>
            </thead>
            <tbody>
              {result.appAssignments.map((a: any, i: number) => (
                <tr key={i}>
                  <td style={tdStyle}>{a.name}</td>
                  <td style={tdStyle}>{a.plan}</td>
                  <td style={tdStyle}>{a.replicas}</td>
                  <td style={tdStyle}>{a.nodesAssigned || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: "#666", fontSize: 13, marginTop: 12 }}>
            <em>
              IP calculation: 14 reserved for infrastructure, +1 per node (Dedicated), +1 per 10 replicas (Consumption, rounded up).<br />
              <strong>Total IPs needed: {result.ips}</strong>
            </em>
          </p>
        </div>
      )}
      <style jsx>{`
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }
      `}</style>
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
