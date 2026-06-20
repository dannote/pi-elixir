# Internal Contracts

Rules for internal data shapes. The short version: data flows through typed structs, not bare maps; normalization happens once at a boundary, not everywhere.

## Define a struct for every internal data shape

If a function returns a compound value that another module reads, it is a struct with a `@type t`, not a map. Use `defstruct` plus `@enforce_keys` for required fields. Adding a field to a struct is a contract change you can grep for; adding a key to a map silently changes behavior. Prefer the greppable one.

```elixir
# good
defmodule MyApp.Binding do
  @enforce_keys [:name, :kind]
  defstruct [:name, :kind, value: nil]

  @type t :: %__MODULE__{
          name: atom(),
          kind: :literal | :expr | :type,
          value: term()
        }
end

# bad — a map shape that every reader has to know
def binding(name, kind, value), do: %{name: name, kind: kind, value: value}
```

## No string-keyed maps across module boundaries

String keys belong at external boundaries: JSON, NIF term decoding, config parsed from files, third-party payloads. Inside the app, use atom keys and structs.

If a string-keyed map arrives at a boundary, normalize it into a struct once, at that boundary, and never again. Everything downstream takes the struct.

```elixir
# at the JSON boundary — normalize once
def from_json!(%{"name" => name, "kind" => kind, "value" => value}) do
  %MyApp.Binding{name: String.to_atom(name), kind: parse_kind!(kind), value: value}
end

# downstream — takes the struct, never the raw map
def render(%MyApp.Binding{} = binding), do: ...
```

## Normalize once, at the boundary

No "normalize on read, normalize on write, normalize in the helper" chains. One function owns the boundary→struct conversion. If you find three functions all calling `Keyword.fetch!(spec, :type)` or `Map.get(payload, "type")` on the same shape, that shape should be a struct and the fetches should be one constructor.

```elixir
# bad — normalization smeared across the call graph
def decoder_expr(spec, term_arg, result) do
  cond do
    decode = Keyword.get(spec, :decode) -> ...
    Keyword.get(spec, :required, false) -> ...
    Keyword.has_key?(spec, :default) -> ...
  end
end

# good — spec is a struct, branches match on its fields
def decoder_expr(%FieldSpec{decode: nil, required: true} = spec, ...) -> ...
def decoder_expr(%FieldSpec{decode: nil, default: {:some, _}} = spec, ...) -> ...
def decoder_expr(%FieldSpec{decode: {:some, expr}} = spec, ...) -> ...
```

## No ad hoc tagged tuples

`{:literal, value}`, `{:expr, code}`, `{:type, type}` are three constructors for one tagged union pretending to be tuples. Make them a struct with a `:kind` field, or a real enum. Pattern-matching on ad hoc tuples is the same anti-pattern as pattern-matching on map shapes: a hope, not a contract.

```elixir
# bad
def binding_value({:literal, value}), do: ...
def binding_value({:expr, value}), do: ...
def binding_value({:type, value}), do: ...

# good
def binding_value(%MyApp.Binding{kind: :literal, value: value}), do: ...
def binding_value(%MyApp.Binding{kind: :expr, value: value}), do: ...
```

## Pattern-match on structs, not on map shapes

`def handle(%MyData{kind: :foo} = d)` is a contract. `def handle(%{kind: "foo"} = m)` is a hope — it silently accepts any map with that string key and will break when the shape drifts. Match on structs and atom keys.

## Keyword lists: pragmatic boundary

Keyword lists are fine for short-lived, same-module values — options at a call site, a quick field list built and consumed in one function. They are not fine for values that cross module boundaries or get stored.

- Acceptable: `render(name, args: [...], returns: ...)` inside one module.
- Not acceptable: a keyword list `[type: :f32, decode: ...]` that gets passed to three other modules and `Keyword.fetch!`-ed in each. That is a struct.

## When a map is genuinely the right type

A dynamic lookup table, a cache, a registry — these are maps. Declare the type explicitly so the untyped map does not propagate:

```elixir
@type lookup :: %{atom() => MyApp.Binding.t()}
```

Don't let an untyped `map()` leak through five functions; if it has a shape, name it.
