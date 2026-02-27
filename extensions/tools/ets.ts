import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { evalTool } from "../helpers.ts";
import { renderElixirResult } from "../renderers.ts";

export function register(pi: ExtensionAPI) {
	evalTool(
		pi,
		"elixir_ets",
		"ETS Tables",
		`Inspect ETS tables in the running BEAM.
Without "table" — lists all tables sorted by memory (default), size, or name.
With "table" — shows table info and contents. Use "match" for pattern matching and "limit" to cap rows.`,
		Type.Object({
			table: Type.Optional(
				Type.String({ description: "Table name (atom) or ID to inspect. Omit to list all tables." }),
			),
			match: Type.Optional(
				Type.String({
					description:
						'Erlang match pattern for :ets.match_object, e.g. "{:_, :active, :_}" to match 3-tuples with :active as second element',
				}),
			),
			limit: Type.Optional(Type.Integer({ description: "Max rows to return (default: 50)" })),
			sort: Type.Optional(Type.String({ description: "Sort table list by: memory (default), size, name" })),
		}),
		(params) => buildCode(params),
		(args, theme) => {
			let text = theme.fg("toolTitle", theme.bold("elixir_ets"));
			if (args.table) text += theme.fg("accent", ` ${args.table}`);
			if (args.match) text += theme.fg("muted", ` match=${args.match}`);
			if (args.sort) text += theme.fg("muted", ` sort=${args.sort}`);
			return new Text(text, 0, 0);
		},
		{ renderResult: renderElixirResult },
	);
}

function buildCode(params: Record<string, unknown>): string {
	const table = params.table ? String(params.table) : null;
	const match = params.match ? String(params.match) : null;
	const limit = params.limit != null ? Number(params.limit) : 50;
	const sort = params.sort ? String(params.sort) : "memory";

	if (!table) {
		return `
tables =
  :ets.all()
  |> Enum.map(fn tid ->
    try do
      info = :ets.info(tid)
      if info == :undefined, do: nil, else: Map.new(info)
    rescue
      _ -> nil
    end
  end)
  |> Enum.reject(&is_nil/1)
  |> Enum.sort_by(& &1[:${sort}], :desc)

format_mem = fn bytes ->
  cond do
    bytes >= 1_048_576 -> "\#{Float.round(bytes * 8 / 1_048_576, 1)} MB"
    bytes >= 1024 -> "\#{Float.round(bytes * 8 / 1024, 1)} KB"
    true -> "\#{bytes * 8} B"
  end
end

header = String.pad_trailing("Name", 40) <> String.pad_leading("Size", 10) <> String.pad_leading("Memory", 12) <> "  Type       Protection  Owner"

lines = Enum.map(tables, fn t ->
  name = inspect(t[:name])
  String.pad_trailing(name, 40) <>
    String.pad_leading("\#{t[:size]}", 10) <>
    String.pad_leading(format_mem.(t[:memory]), 12) <>
    "  " <> String.pad_trailing("\#{t[:type]}", 11) <>
    String.pad_trailing("\#{t[:protection]}", 12) <>
    inspect(t[:owner])
end)

"\#{length(tables)} ETS tables (sorted by ${sort})\\n\\n" <> header <> "\\n" <> Enum.join(lines, "\\n")
`;
	}

	const tableRef = table.match(/^\d+$/) ? `:ets.whereis(${table})` : table.startsWith(":") ? `${table}` : `:"${table}"`;

	return `
table = ${tableRef}

case :ets.info(table) do
  :undefined -> "ETS table not found: ${table}"
  info ->
    info = Map.new(info)

    format_mem = fn bytes ->
      cond do
        bytes >= 1_048_576 -> "\#{Float.round(bytes * 8 / 1_048_576, 1)} MB"
        bytes >= 1024 -> "\#{Float.round(bytes * 8 / 1024, 1)} KB"
        true -> "\#{bytes * 8} B"
      end
    end

    header = """
    Name:       \#{inspect(info[:name])}
    ID:         \#{inspect(info[:id])}
    Type:       \#{info[:type]}
    Protection: \#{info[:protection]}
    Owner:      \#{inspect(info[:owner])}
    Size:       \#{info[:size]} objects
    Memory:     \#{format_mem.(info[:memory])}
    Compressed: \#{info[:compressed]}
    """

    rows = try do
      ${
				match
					? `
      pattern = Code.eval_string("${match.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}") |> elem(0)
      :ets.match_object(table, pattern)
      `
					: `
      :ets.tab2list(table)
      `
			}
    rescue
      e -> {:error, Exception.message(e)}
    end

    case rows do
      {:error, msg} ->
        header <> "\\nError reading table: \#{msg}"
      rows ->
        total = length(rows)
        rows = Enum.take(rows, ${limit})
        content = Enum.map_join(rows, "\\n", fn row ->
          inspect(row, pretty: true, limit: 10, width: 120)
        end)
        suffix = if total > ${limit}, do: "\\n\\n(\#{total} total, showing first ${limit})", else: ""
        header <> "\\nContents (\#{total} rows):\\n\\n" <> content <> suffix
    end
end
`;
}
