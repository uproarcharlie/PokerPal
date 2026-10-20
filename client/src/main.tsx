import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import App from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");
createRoot(root).render(<App />);
