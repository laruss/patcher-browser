import { runSandboxNetRelay } from "./sandbox-net-relay.js";

/**
 * The first process inside a network-confined Linux sandbox.
 *
 * Its own file, with nothing but this call in it, because the daemon imports
 * the module beside it to build the argv that spawns this — and a module that
 * starts a relay on import starts one in the daemon too. See
 * `RELAY_ENTRY_SOURCE_PATH` there for what that looked like when it happened.
 */
void runSandboxNetRelay(process.argv.slice(2));
