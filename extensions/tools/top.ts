import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool, loadScript, wrapWithBindings } from "../helpers.ts";

export function register(pi: ExtensionAPI) {
	evalTool(
		pi,
		"elixir_top",
		"Process Top",
		`List top BEAM processes by resource usage, like a process manager.
Shows process name/MFA, PID, memory, message queue length, reductions, and current function.
Use to find memory leaks, overloaded mailboxes, or busy processes.`,
		Type.Object({
			sort: Type.Optional(
				Type.String({
					description: "Sort by: memory (default), reductions, message_queue_len",
				}),
			),
			limit: Type.Optional(Type.Integer({ description: "Number of processes to show (default: 15)" })),
		}),
		(params) =>
			wrapWithBindings(loadScript("top"), {
				sort_by: params.sort ?? "memory",
				max_results: params.limit ?? 15,
			}),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_top"));
			if (args.sort) text += theme.fg("muted", ` sort=${args.sort}`);
			if (args.limit) text += theme.fg("muted", ` limit=${args.limit}`);
			return new Text(text, 0, 0);
		},
	);
}
