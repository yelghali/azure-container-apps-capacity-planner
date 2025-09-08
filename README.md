# Azure Container Apps Capacity Planner

This project is an interactive tool to help you estimate the required subnet size, node types, and IP usage for deploying Azure Container Apps. It supports planning for both peak usage and zero-downtime upgrade scenarios, and helps you choose between Consumption, Dedicated, or Mixed plans.

## 🚀 Live Demo

Try it now: [https://yelghali.github.io/azure-container-apps-capacity-planner/](https://yelghali.github.io/azure-container-apps-capacity-planner/)

## Features

- **Subnet IP Calculation:** Enter your subnet size (e.g. `/24`) and see available IPs.
- **App Requirements:** Specify CPU, RAM, GPU, min/max replicas, and plan type for each app.
- **Plan Selection:** Choose between Consumption, Dedicated, or Mix (per-app) plans.
- **Node Packing:** For Dedicated, the tool picks the smallest node type (SKU) that fits each app and packs replicas efficiently.
- **Peak & Upgrade Planning:** Calculates required nodes and IPs for both peak usage and zero-downtime upgrade (min replicas doubled).
- **Warnings:** Alerts if your subnet is too small for your requirements.

## How it works

1. **Network IP Calculation:** Calculates available IPs as `2^(32 - subnet bits) - 14` (the `-14` accounts for Azure reserved addresses).
2. **App Scheduling:** For Dedicated, each app is assigned the smallest node type that fits its resource needs, and replicas are packed onto as few nodes as possible.
3. **Capacity Planning:** Estimates IPs and node assignments for both peak and upgrade phases.
4. **Results:** Shows detailed node assignments, IP usage, and warnings.

## Getting Started

Clone the repo and run locally:

```bash
git clone https://github.com/yelghali/azure-container-apps-capacity-planner.git
cd azure-container-apps
```

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm run dev
```

Open your browser and navigate to `http://localhost:3000`.

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
