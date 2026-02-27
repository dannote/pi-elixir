import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool } from "../helpers.ts";

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
		(params) => buildCode(params),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_top"));
			if (args.sort) text += theme.fg("muted", ` sort=${args.sort}`);
			if (args.limit) text += theme.fg("muted", ` limit=${args.limit}`);
			return new Text(text, 0, 0);
		},
	);
}

function buildCode(params: Record<string, unknown>): string {
	const sort = params.sort ? String(params.sort) : "memory";
	const limit = params.limit != null ? Number(params.limit) : 15;
	return `
sort_key = :${sort}
limit = ${limit}

Process.list()
|> Enum.map(fn pid ->
  info = Process.info(pid, [:registered_name, :memory, :message_queue_len, :reductions, :current_function, :initial_call, :dictionary])
  case info do
    nil -> nil
    info ->
      name = case info[:registered_name] do
        [] -> nil
        n -> n
      end
      init_call = case info[:dictionary][:"$initial_call"] do
        {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
        _ -> case info[:initial_call] do
          {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
          _ -> nil
        end
      end
      current = case info[:current_function] do
        {m, f, a} -> "\#{inspect(m)}.\#{f}/\#{a}"
        _ -> "?"
      end
      label = cond do
        name -> inspect(name)
        init_call -> init_call
        true -> inspect(pid)
      end
      %{
        pid: inspect(pid),
        name: label,
        memory: info[:memory],
        message_queue_len: info[:message_queue_len],
        reductions: info[:reductions],
        current: current
      }
  end
end)
|> Enum.reject(&is_nil/1)
|> Enum.sort_by(& &1[sort_key], :desc)
|> Enum.take(limit)
|> Enum.with_index(1)
|> Enum.map(fn {p, i} ->
  mem = cond do
    p.memory >= 1_048_576 -> "\#{Float.round(p.memory / 1_048_576, 1)} MB"
    p.memory >= 1024 -> "\#{Float.round(p.memory / 1024, 1)} KB"
    true -> "\#{p.memory} B"
  end
  rank = String.pad_leading("\#{i}", 3)
  "\#{rank}. \#{p.pid} \#{String.pad_trailing(p.name, 48)} mem=\#{String.pad_leading(mem, 10)} msgq=\#{String.pad_leading("\#{p.message_queue_len}", 6)} reds=\#{p.reductions}"
end)
|> Enum.join("\\n")
`;
}
