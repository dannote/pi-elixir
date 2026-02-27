target =
  case target_ref do
    "pid:" <> pid_str ->
      :erlang.list_to_pid(~c"<#{pid_str}>")
    name_str ->
      Module.concat(String.split(name_str, "."))
      |> Process.whereis()
  end

case target do
  nil -> "Process not found: #{target_ref}"
  pid when is_pid(pid) ->
    info = Process.info(pid, [
      :registered_name, :memory, :message_queue_len, :messages, :reductions,
      :current_function, :initial_call, :status, :links, :monitors, :monitored_by,
      :trap_exit, :dictionary, :heap_size, :stack_size, :total_heap_size
    ])
    case info do
      nil -> "Process #{inspect(pid)} is dead"
      info ->
        name = case info[:registered_name] do
          [] -> "none"
          n -> inspect(n)
        end
        init = case info[:dictionary][:"$initial_call"] do
          {m, f, a} -> "#{inspect(m)}.#{f}/#{a}"
          _ -> case info[:initial_call] do
            {m, f, a} -> "#{inspect(m)}.#{f}/#{a}"
            _ -> "?"
          end
        end
        current = case info[:current_function] do
          {m, f, a} -> "#{inspect(m)}.#{f}/#{a}"
          _ -> "?"
        end
        mem = Float.round(info[:memory] / 1024, 1)
        msgs = info[:messages] |> Enum.take(5) |> inspect(pretty: true, limit: 3)
        links = info[:links] |> Enum.map(&inspect/1) |> Enum.join(", ")
        monitors = info[:monitors] |> Enum.take(10) |> Enum.map(fn
          {:process, p} -> inspect(p)
          other -> inspect(other)
        end) |> Enum.join(", ")

        state = try do
          s = :sys.get_state(pid)
          inspect(s, pretty: true, limit: 20, printable_limit: 1024)
        rescue
          _ -> "(not a GenServer or state unavailable)"
        end

        """
        PID:              #{inspect(pid)}
        Registered name:  #{name}
        Initial call:     #{init}
        Current function: #{current}
        Status:           #{info[:status]}
        Memory:           #{mem} KB
        Heap size:        #{info[:heap_size]} words
        Stack size:       #{info[:stack_size]} words
        Reductions:       #{info[:reductions]}
        Message queue:    #{info[:message_queue_len]} messages
        Messages (first 5): #{msgs}
        Links:            #{if links == "", do: "none", else: links}
        Monitors:         #{if monitors == "", do: "none", else: monitors}
        Monitored by:     #{info[:monitored_by] |> Enum.map(&inspect/1) |> Enum.join(", ") |> then(& if &1 == "", do: "none", else: &1)}
        Trap exit:        #{info[:trap_exit]}

        State:
        #{state}
        """
    end
end
