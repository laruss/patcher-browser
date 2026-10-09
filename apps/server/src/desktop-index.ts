import { Socket } from "node:net";
import { startServerEntry } from "./server-entry.js";

// Ordinary/headless startup never probes a descriptor for this capability.
startServerEntry(new Socket({ fd: 3, readable: true, writable: true }));
