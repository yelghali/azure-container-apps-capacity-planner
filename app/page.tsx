"use client";

import { useState } from "react";

type PlanType = "Consumption" | "Dedicated";
type PlanChoice = PlanType | "Mix";

type AppInput = {
  name: string;
  cpu: number;
  gpu: number;
  ram: number;
  minReplicas: number;
  baselineReplicas: number;
  replicas: number;
  plan?: PlanType;
  baselineTouched?: boolean; // <-- add this
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

// Add this function before Home()
function validateAllApps(apps: AppInput[], planChoice: PlanChoice): string[] {
  const errors: string[] = [];
  apps.forEach((app, idx) => {
    const err = validateAppInput(app, planChoice);
    if (err) errors.push(`App ${app.name || idx + 1}: ${err}`);
    if (app.cpu <= 0) errors.push(`App ${app.name || idx + 1}: CPU must be greater than 0.`);
    if (app.ram <= 0) errors.push(`App ${app.name || idx + 1}: RAM must be greater than 0.`);
    if (app.minReplicas > app.replicas) errors.push(`App ${app.name || idx + 1}: Min Replicas must be less than or equal to Max Replicas.`);
    if (app.baselineReplicas < app.minReplicas || app.baselineReplicas > app.replicas) {
      errors.push(`App ${app.name || idx + 1}: Baseline Replicas must be between Min and Max Replicas.`);
    }
  });
  return errors;
}

export default function Home() {
  const [apps, setApps] = useState<AppInput[]>([
    { name: "", cpu: 0, gpu: 0, ram: 0, minReplicas: 1, baselineReplicas: 1, replicas: 1, plan: "Consumption", baselineTouched: false },
  ]);
  const [subnetSize, setSubnetSize] = useState("");
  const [planChoice, setPlanChoice] = useState<PlanChoice>("Consumption");
  const [result, setResult] = useState<any>(null);
  const [showNodeInfo, setShowNodeInfo] = useState(false);
  const [inputErrors, setInputErrors] = useState<string[]>([]);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [computeAlloc, setComputeAlloc] = useState<any[] | null>(null);

  const availableIPs = getAvailableIPs(subnetSize);

  // Helper: For each app, assign a compute type and show node allocation for baselineReplicas
  function suggestComputeAllocation(apps: AppInput[], planChoice: PlanChoice) {
    // For each app, assign a node type (Dedicated) or "Consumption"
    // For Dedicated: pack baselineReplicas into as few nodes as possible
    // For Consumption: just show "Consumption"
    const rows: {
      appName: string;
      plan: string;
      baselineReplicas: number;
      computeType: string;
      nodesNeeded: number | string;
      perNodeCapacity: number | string;
      allocation: string;
    }[] = [];

    // Split apps by plan if Mix, else all same
    let consApps: AppInput[] = [];
    let dedApps: AppInput[] = [];
    if (planChoice === "Mix") {
      consApps = apps.filter(a => a.plan === "Consumption");
      dedApps = apps.filter(a => a.plan === "Dedicated");
    } else if (planChoice === "Consumption") {
      consApps = apps;
    } else if (planChoice === "Dedicated") {
      dedApps = apps;
    }

    // Consumption apps
    consApps.forEach(app => {
      rows.push({
        appName: app.name || "(unnamed)",
        plan: "Consumption",
        baselineReplicas: app.baselineReplicas,
        computeType: "Consumption",
        nodesNeeded: "-",
        perNodeCapacity: "-",
        allocation: "-",
      });
    });

    // Dedicated apps: assign node type and pack baselineReplicas
    dedApps.forEach(app => {
      // Find smallest node type that fits a single replica
      const nodeType = DEDICATED_NODE_TYPES.find(
        n => n.cpu >= app.cpu && n.ram >= app.ram && n.gpu >= app.gpu
      );
      if (!nodeType) {
        rows.push({
          appName: app.name || "(unnamed)",
          plan: "Dedicated",
          baselineReplicas: app.baselineReplicas,
          computeType: "N/A",
          nodesNeeded: "N/A",
          perNodeCapacity: "N/A",
          allocation: "No suitable node type",
        });
        return;
      }
      // How many replicas fit on one node of this type?
      const perNodeCapacity = Math.min(
        Math.floor(nodeType.cpu / app.cpu),
        Math.floor(nodeType.ram / app.ram),
        app.gpu > 0 ? Math.floor(nodeType.gpu / app.gpu) : Infinity
      );
      const nodesNeeded = perNodeCapacity > 0 ? Math.ceil(app.baselineReplicas / perNodeCapacity) : 0;
      // Allocation string
      let allocation = "-";
      if (nodesNeeded > 0 && perNodeCapacity > 0) {
        const nodeAssignments: string[] = [];
        for (let node = 1; node <= nodesNeeded; node++) {
          const startReplica = (node - 1) * perNodeCapacity + 1;
          let endReplica = node * perNodeCapacity;
          if (endReplica > app.baselineReplicas) endReplica = app.baselineReplicas;
          nodeAssignments.push(
            app.baselineReplicas === 1
              ? `Node ${node} (${nodeType.name})`
              : `Node ${node} (${nodeType.name}): replicas ${startReplica}-${endReplica}`
          );
        }
        allocation = nodeAssignments.join(", ");
      }
      rows.push({
        appName: app.name || "(unnamed)",
        plan: "Dedicated",
        baselineReplicas: app.baselineReplicas,
        computeType: nodeType.name,
        nodesNeeded,
        perNodeCapacity,
        allocation,
      });
    });

    return rows;
  }

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
    let validationMessage = "";

    if (field === "name") {
      updated[idx][field] = value as AppInput[typeof field];
    } else if (field === "plan") {
      updated[idx][field] = value as PlanType;
    } else if (field === "baselineReplicas") {
      updated[idx][field] = Number(value) as AppInput[typeof field];
      updated[idx].baselineTouched = true;

      // If baseline > replicas, set both to the biggest value
      if (updated[idx].baselineReplicas > updated[idx].replicas) {
        const biggest = Math.max(updated[idx].baselineReplicas, updated[idx].replicas);
        updated[idx].baselineReplicas = biggest;
        updated[idx].replicas = biggest;
        updated[idx].baselineTouched = false;
        validationMessage = `App ${updated[idx].name || idx + 1}: Baseline Replicas cannot be greater than Max Replicas. Both set to ${biggest}.`;
      }
    } else if (
      field === "cpu" ||
      field === "gpu" ||
      field === "ram" ||
      field === "minReplicas" ||
      field === "replicas"
    ) {
      updated[idx][field] = Number(value) as AppInput[typeof field];

      // CPU and RAM must be > 0
      if ((field === "cpu" || field === "ram") && updated[idx][field] <= 0) {
        updated[idx][field] = 1 as AppInput[typeof field];
        validationMessage = `App ${updated[idx].name || idx + 1}: ${field.toUpperCase()} must be greater than 0. Value set to 1.`;
      }

      // If minReplicas > replicas or baseline, set all three to the largest value
      if (
        field === "minReplicas" &&
        (updated[idx].minReplicas > updated[idx].replicas ||
          updated[idx].minReplicas > updated[idx].baselineReplicas)
      ) {
        const biggest = Math.max(updated[idx].minReplicas, updated[idx].replicas, updated[idx].baselineReplicas);
        updated[idx].minReplicas = biggest;
        updated[idx].replicas = biggest;
        updated[idx].baselineReplicas = biggest;
        updated[idx].baselineTouched = false;
        validationMessage = `App ${updated[idx].name || idx + 1}: Min Replicas cannot be greater than Max or Baseline. All set to ${biggest}.`;
      }

      // If min or max changes, update baseline if not touched and not already fixed above
      if (
        (field === "replicas" || field === "minReplicas") &&
        !updated[idx].baselineTouched &&
        !validationMessage
      ) {
        const min = updated[idx].minReplicas;
        const max = updated[idx].replicas;
        updated[idx].baselineReplicas = Math.round(min + (max - min) / 2);
      }
    }

    setApps(updated);

    // Show validation message if any
    if (validationMessage) {
      setInputErrors([validationMessage]);
      setTimeout(() => setInputErrors([]), 4000);
    }
  };

  const addApp = () => {
    const min = 1;
    const max = 1;
    const baseline = Math.round(min + (max - min) / 2);
    setApps([
      ...apps,
      {
        name: "",
        cpu: 0,
        gpu: 0,
        ram: 0,
        minReplicas: min,
        baselineReplicas: baseline,
        replicas: max,
        plan: planChoice === "Mix" ? "Consumption" : undefined,
        baselineTouched: false,
      },
    ]);
  };

  const removeApp = (idx: number) => {
    setApps(apps.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate all apps
    const errors = validateAllApps(apps, planChoice);
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

  // Add this handler for the Suggest Compute button
  const handleSuggestCompute = () => {
    try {
      // Validate CPU and RAM > 0 for all apps
      const errors: string[] = [];
      apps.forEach((app, idx) => {
        if (app.cpu <= 0) errors.push(`App ${app.name || idx + 1}: CPU must be greater than 0.`);
        if (app.ram <= 0) errors.push(`App ${app.name || idx + 1}: RAM must be greater than 0.`);
      });
      const otherErrors = validateAllApps(apps, planChoice);
      const allErrors = [...errors, ...otherErrors];
      setInputErrors(allErrors);
      if (allErrors.length > 0) {
        setComputeAlloc(null);
        return;
      }
      setComputeAlloc(suggestComputeAllocation(apps, planChoice));
      setInputErrors([]);
    } catch (e: any) {
      setInputErrors([e?.message || "An error occurred while suggesting compute allocation."]);
      setComputeAlloc(null);
    }
  };

  return (
    <main style={{ maxWidth: 1100, margin: "2rem auto", fontFamily: "sans-serif" }}>
      {/* Show validation errors if any */}
      {inputErrors.length > 0 && (
        <div style={{
          background: "#ffeaea",
          color: "#c00",
          border: "1px solid #c00",
          borderRadius: 6,
          padding: "12px 18px",
          marginBottom: 18,
          fontWeight: 600
        }}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {inputErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
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