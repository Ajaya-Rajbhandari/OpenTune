import "./styles.css";
import { mountShell } from "./shell";
import { bootstrap } from "./ui";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app root");

mountShell(root);
bootstrap();
