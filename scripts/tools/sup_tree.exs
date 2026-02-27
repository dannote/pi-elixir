defmodule PiSupTree do
  def print(sup, depth \\ 0, max_depth) do
    indent = String.duplicate("  ", depth)
    children = try do
      Supervisor.which_children(sup)
    rescue
      _ -> []
    end

    children
    |> Enum.map(fn {id, pid, type, modules} ->
      id_str = if is_atom(id), do: inspect(id), else: "#{inspect(id)}"
      pid_str = case pid do
        p when is_pid(p) -> inspect(p)
        :restarting -> "restarting"
        :undefined -> "undefined"
      end
      mod_str = case modules do
        :dynamic -> "dynamic"
        [m] -> inspect(m)
        ms -> inspect(ms)
      end

      line = "#{indent}├─ #{id_str} [#{type}] #{pid_str} (#{mod_str})"

      sub = if type == :supervisor and is_pid(pid) and (max_depth == nil or depth < max_depth) do
        try do
          info = Supervisor.count_children(pid)
          strategy = case :sys.get_status(pid) do
            {:status, _, _, [_, _, _, _, [header | _]]} ->
              case header do
                {_, _, {:data, data}} -> Keyword.get(data, :strategy, :unknown)
                _ -> :unknown
              end
            _ -> :unknown
          end
          header = "#{indent}│  strategy=#{strategy} active=#{info[:active]} specs=#{info[:specs]}"
          header <> "\n" <> print(pid, depth + 1, max_depth)
        rescue
          _ -> ""
        end
      else
        ""
      end

      if sub != "", do: line <> "\n" <> sub, else: line
    end)
    |> Enum.join("\n")
  end
end

root =
  case root_module do
    nil ->
      app = Mix.Project.config()[:app]
      master = :application_controller.get_master(app)
      {top_sup, _mod} = :application_master.get_child(master)
      top_sup
    name ->
      name |> String.split(".") |> Module.concat() |> Process.whereis()
  end

case root do
  nil -> "Could not auto-detect application supervisor. Pass root=MyApp.Supervisor explicitly."
  pid ->
    name = case Process.info(pid, :registered_name) do
      {:registered_name, name} when is_atom(name) -> inspect(name)
      _ -> inspect(pid)
    end
    strategy = try do
      case :sys.get_status(pid) do
        {:status, _, _, [_, _, _, _, [header | _]]} ->
          case header do
            {_, _, {:data, data}} -> Keyword.get(data, :strategy, :unknown)
            _ -> :unknown
          end
        _ -> :unknown
      end
    rescue
      _ -> :unknown
    end
    header = "#{name} (strategy=#{strategy})\n"
    header <> PiSupTree.print(pid, 0, max_depth)
end
