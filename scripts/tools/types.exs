case reference do
  ref when is_binary(ref) ->
    parts = String.split(ref, ".")
    has_slash = String.contains?(ref, "/")
    last_part = List.last(parts)
    last_base = if has_slash, do: hd(String.split(last_part, "/")), else: last_part
    has_fun = length(parts) > 1 and String.match?(last_base, ~r/^[a-z_]/)

    {mod, fun, arity} =
      if has_fun do
        {fun_part, mod_parts} = List.pop_at(parts, -1)

        if has_slash do
          [fun_name, arity_str] = String.split(fun_part, "/")
          {Module.concat(mod_parts), String.to_atom(fun_name), String.to_integer(arity_str)}
        else
          {Module.concat(mod_parts), String.to_atom(fun_part), :*}
        end
      else
        {Module.concat(parts), nil, :*}
      end

    Code.ensure_loaded!(mod)

    if fun == nil do
      types = case Code.Typespec.fetch_types(mod) do
        {:ok, types} ->
          types
          |> Enum.sort_by(fn {kind, {name, _, _}} -> {kind, name} end)
          |> Enum.map(fn {kind, type_ast} ->
            "@#{kind} #{Macro.to_string(Code.Typespec.type_to_quoted(type_ast))}"
          end)
        :error -> []
      end

      specs = case Code.Typespec.fetch_specs(mod) do
        {:ok, specs} ->
          Enum.flat_map(specs, fn {{f, _a}, spec_list} ->
            Enum.map(spec_list, fn spec ->
              "@spec #{Macro.to_string(Code.Typespec.spec_to_quoted(f, spec))}"
            end)
          end)
          |> Enum.sort()
        :error -> []
      end

      callbacks = case Code.Typespec.fetch_callbacks(mod) do
        {:ok, cbs} ->
          Enum.flat_map(cbs, fn {{f, _a}, spec_list} ->
            Enum.map(spec_list, fn spec ->
              "@callback #{Macro.to_string(Code.Typespec.spec_to_quoted(f, spec))}"
            end)
          end)
          |> Enum.sort()
        :error -> []
      end

      parts = []
      parts = if types != [], do: parts ++ ["## Types\n" <> Enum.join(types, "\n")], else: parts
      parts = if specs != [], do: parts ++ ["## Specs\n" <> Enum.join(specs, "\n")], else: parts
      parts = if callbacks != [], do: parts ++ ["## Callbacks\n" <> Enum.join(callbacks, "\n")], else: parts

      if parts == [] do
        "No types, specs, or callbacks found for #{inspect(mod)}"
      else
        "# #{inspect(mod)}\n\n" <> Enum.join(parts, "\n\n")
      end
    else
      specs = case Code.Typespec.fetch_specs(mod) do
        {:ok, specs} ->
          Enum.flat_map(specs, fn {{f, a}, spec_list} ->
            if f == fun and (arity == :* or a == arity) do
              Enum.map(spec_list, fn spec ->
                "@spec #{Macro.to_string(Code.Typespec.spec_to_quoted(f, spec))}"
              end)
            else
              []
            end
          end)
        :error -> []
      end

      if specs == [] do
        "No specs found for #{inspect(mod)}.#{fun}#{if arity != :*, do: "/#{arity}", else: ""}"
      else
        Enum.join(specs, "\n")
      end
    end
end
