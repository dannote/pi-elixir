target = module_name |> String.split(".") |> Module.concat()

all = Mix.Tasks.Xref.calls()

exports =
  if direction in ["exports", "both"] do
    all
    |> Enum.filter(fn %{caller_module: caller} -> caller == target end)
    |> Enum.map(fn %{callee: {m, f, a}} -> {m, f, a} end)
    |> Enum.uniq()
    |> Enum.sort()
    |> Enum.group_by(&elem(&1, 0))
    |> Enum.sort_by(fn {mod, _} -> inspect(mod) end)
  else
    []
  end

callers =
  if direction in ["callers", "both"] do
    all
    |> Enum.filter(fn %{callee: {m, _, _}} -> m == target end)
    |> Enum.map(fn %{caller_module: caller, callee: {_, f, a}} -> {caller, f, a} end)
    |> Enum.uniq()
    |> Enum.sort()
    |> Enum.group_by(&elem(&1, 0))
    |> Enum.sort_by(fn {mod, _} -> inspect(mod) end)
  else
    []
  end

format_group = fn grouped, header ->
  if grouped == [] do
    "#{header}: (none)"
  else
    lines = Enum.map(grouped, fn {mod, funs} ->
      calls = Enum.map(funs, fn {_, f, a} -> "#{f}/#{a}" end) |> Enum.join(", ")
      "  #{inspect(mod)} — #{calls}"
    end)
    "#{header} (#{length(grouped)} modules):\n" <> Enum.join(lines, "\n")
  end
end

parts = []
parts = if direction in ["exports", "both"], do: parts ++ [format_group.(exports, "Calls (this module depends on)")], else: parts
parts = if direction in ["callers", "both"], do: parts ++ [format_group.(callers, "Called by (depends on this module)")], else: parts

"# #{inspect(target)}\n\n" <> Enum.join(parts, "\n\n")
