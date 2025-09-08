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

function getAvailableIPs(subnet: string): number | null {
  // Accepts /24, 24, or 255.255.255.0
  let bits: number | null = null;
  if (subnet.startsWith("/")) {
    bits = parseInt(subnet.slice(1), 10);
  } else if (/^\d+$/.test(subnet)) {
    bits = parseInt(subnet, 10);
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(subnet)) {
    // Convert netmask to bits
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

export default function Home() {
  const [apps, setApps] = useState<AppInput[]>([
    { name: "", cpu: 0, gpu: 0, ram: 0, replicas: 1, plan: "Consumption" },
  ]);
  const [subnetSize, setSubnetSize] = useState("");
  const [planChoice, setPlanChoice] = useState<PlanChoice>("Consumption");
  const [result, setResult] = useState<
    { plan: string; ips: number; details?: string } | null
  >(null);

  const availableIPs = getAvailableIPs(subnetSize);

  function calculate(apps: AppInput[], subnet: string, planChoice: PlanChoice) {
    let plan = planChoice;
    let ips = 0;
    let details = "";

    if (planChoice === "Mix") {
      const consApps = apps.filter((a) => a.plan === "Consumption");
      const dedApps = apps.filter((a) => a.plan === "Dedicated");
      const consReplicas = consApps.reduce((sum, app) => sum + app.replicas, 0);
      const dedReplicas = dedApps.reduce((sum, app) => sum + app.replicas, 0);
      ips = consReplicas + dedReplicas + 1;
      details = `Consumption apps: ${consApps.length}, Dedicated apps: ${dedApps.length}`;
    } else {
      const totalReplicas = apps.reduce((sum, app) => sum + app.replicas, 0);
      ips = totalReplicas + 1;
    }

    return { plan: planChoice, ips, details };
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

  // If planChoice changes, reset per-app plan if not "Mix"
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
          <p>
            <strong>Selected Plan:</strong> {result.plan}
          </p>
          <p>
            <strong>Estimated IPs Used:</strong> {result.ips}
          </p>
          {result.details && (
            <p>
              <strong>Details:</strong> {result.details}
            </p>
          )}
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
