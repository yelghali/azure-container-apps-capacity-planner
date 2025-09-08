"use client";

import Image from "next/image";
import { Inter } from "next/font/google";
import { useState } from "react";
import styles from "./page.module.css";
import Content from "./message.mdx";

const inter = Inter({ subsets: ["latin"] });

type AppInput = {
  name: string;
  cpu: number;
  gpu: number;
  ram: number;
  replicas: number;
};

export default function Home() {
  const [apps, setApps] = useState<AppInput[]>([
    { name: "", cpu: 0, gpu: 0, ram: 0, replicas: 1 },
  ]);
  const [subnetSize, setSubnetSize] = useState("");
  const [result, setResult] = useState<{ plan: string; ips: number } | null>(
    null
  );

  function calculate(apps: AppInput[], subnet: string) {
    const totalReplicas = apps.reduce((sum, app) => sum + app.replicas, 0);
    const totalCPU = apps.reduce((sum, app) => sum + app.cpu * app.replicas, 0);

    let plan = "Consumption";
    if (totalCPU > 8) plan = "Dedicated";
    if (totalCPU > 32) plan = "Premium";

    const ips = totalReplicas + 1;
    return { plan, ips };
  }

  const handleAppChange = (idx: number, field: keyof AppInput, value: string) => {
    const updated = [...apps];
    updated[idx][field] =
      field === "name" ? value : Number(value);
    setApps(updated);
  };

  const addApp = () => {
    setApps([...apps, { name: "", cpu: 0, gpu: 0, ram: 0, replicas: 1 }]);
  };

  const removeApp = (idx: number) => {
    setApps(apps.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(calculate(apps, subnetSize));
  };

  return (
    <main className={`${styles.main} ${inter.className}`} style={{ maxWidth: 600, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <div className={styles.description}>
        <p>
          Get started by editing&nbsp;
          <code className={styles.code}>app/page.tsx</code>
        </p>
        <div>
          <a
            href="https://vercel.com?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
            target="_blank"
            rel="noopener noreferrer"
          >
            By{" "}
            <Image
              src="/vercel.svg"
              alt="Vercel Logo"
              className={styles.vercelLogo}
              width={100}
              height={24}
              priority
            />
          </a>
        </div>
      </div>

      <div className={styles.center}>
        <div>
          <Content />
        </div>
      </div>

      <div className={styles.grid}>
        <a
          href="https://nextjs.org/docs?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
          className={styles.card}
          target="_blank"
          rel="noopener noreferrer"
        >
          <h2>
            Docs <span>-&gt;</span>
          </h2>
          <p>Find in-depth information about Next.js features and API.</p>
        </a>

        <a
          href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
          className={styles.card}
          target="_blank"
          rel="noopener noreferrer"
        >
          <h2>
            Templates <span>-&gt;</span>
          </h2>
          <p>Explore starter templates for Next.js.</p>
        </a>

        <a
          href="https://vercel.com/new?utm_source=create-next-app&utm_medium=appdir-template&utm_campaign=create-next-app"
          className={styles.card}
          target="_blank"
          rel="noopener noreferrer"
        >
          <h2>
            Deploy <span>-&gt;</span>
          </h2>
          <p>
            Instantly deploy your Next.js site to a shareable URL with Vercel.
          </p>
        </a>
      </div>

      <h1>Azure Container App Capacity Planner</h1>
      <form onSubmit={handleSubmit}>
        <h2>Apps</h2>
        {apps.map((app, idx) => (
          <div key={idx} style={{ border: "1px solid #ccc", padding: 10, marginBottom: 10 }}>
            <input
              type="text"
              placeholder="App Name"
              value={app.name}
              onChange={e => handleAppChange(idx, "name", e.target.value)}
              required
              style={{ marginRight: 8 }}
            />
            <input
              type="number"
              placeholder="CPU"
              value={app.cpu}
              min={0}
              step={0.1}
              onChange={e => handleAppChange(idx, "cpu", e.target.value)}
              required
              style={{ width: 70, marginRight: 8 }}
            />
            <input
              type="number"
              placeholder="GPU"
              value={app.gpu}
              min={0}
              step={1}
              onChange={e => handleAppChange(idx, "gpu", e.target.value)}
              required
              style={{ width: 70, marginRight: 8 }}
            />
            <input
              type="number"
              placeholder="RAM (GB)"
              value={app.ram}
              min={0}
              step={0.1}
              onChange={e => handleAppChange(idx, "ram", e.target.value)}
              required
              style={{ width: 90, marginRight: 8 }}
            />
            <input
              type="number"
              placeholder="Max Replicas"
              value={app.replicas}
              min={1}
              step={1}
              onChange={e => handleAppChange(idx, "replicas", e.target.value)}
              required
              style={{ width: 110, marginRight: 8 }}
            />
            {apps.length > 1 && (
              <button type="button" onClick={() => removeApp(idx)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={addApp} style={{ marginBottom: 16 }}>
          + Add App
        </button>
        <div>
          <input
            type="text"
            placeholder="Subnet Size (e.g. /24)"
            value={subnetSize}
            onChange={e => setSubnetSize(e.target.value)}
            required
            style={{ marginRight: 8 }}
          />
        </div>
        <button type="submit" style={{ marginTop: 16 }}>
          Calculate
        </button>
      </form>
      {result && (
        <div style={{ marginTop: 32, padding: 16, border: "1px solid #0078d4", background: "#f3f9fd" }}>
          <h2>Results</h2>
          <p>
            <strong>Recommended Plan:</strong> {result.plan}
          </p>
          <p>
            <strong>Estimated IPs Used:</strong> {result.ips}
          </p>
        </div>
      )}
    </main>
  );
}
