# Serialization (JSON)

The invariant: **use `JSONCodec` for decode, `Jason.Encoder` for encode. Never hand-roll JSON map↔struct conversion.**

`Jason` parses JSON into string-keyed maps. That is its only job in a JSONCodec project. The string-keyed map is a **boundary value** — it exists only at the JSON edge. Converting it into a struct is `JSONCodec`'s job, generated from `defstruct` + `@type t`. Going the other way, encoding a struct to JSON is the `Jason.Encoder` protocol's job, not a hand-rolled `to_map`.

## Decode: JSONCodec, not hand-rolled `from_map!`

Every JSON-shaped struct `use`s `JSONCodec`. The struct's `defstruct` and `@type t` are the source of truth; `JSONCodec` generates `from_map!/1`, `from_map/1`, `decode!/1`, `decode/1`, `to_map/1`, `schema/0`.

```elixir
defmodule MyApp.DataRef do
  use JSONCodec

  defstruct [:type, :function, :name, :index]

  @type t :: %__MODULE__{
          type: :argument | :return | :variable,
          function: MyApp.FunctionID.t(),
          name: atom() | nil,
          index: non_neg_integer() | nil
        }

  codec :name, atom: :unsafe
end
```

Generated API:

```elixir
MyApp.DataRef.decode!(json)         # Jason.decode! + from_map!, one boundary pass
MyApp.DataRef.from_map!(map)        # string-keyed map -> struct
MyApp.DataRef.to_map(struct)        # struct -> string-keyed map (compatibility helper)
JSONCodec.decode!(json, MyApp.DataRef)
JSONCodec.from_map!(map, MyApp.DataRef)
```

**Never write this:**

```elixir
# bad — hand-rolled from_map!, the pattern JSONCodec exists to kill
def from_map!(%{"type" => type, "function" => function} = map) do
  %DataRef{
    type: String.to_atom(type),
    function: FunctionID.from_map!(function),
    name: Map.get(map, "name") && String.to_atom(Map.fetch!(map, "name")),
    index: Map.get(map, "index")
  }
end
```

If you find yourself writing `Map.fetch!(map, "foo")` or `Map.get(map, "foo")` on a string-keyed map inside `lib/`, you are reinventing `JSONCodec`. Stop and use it.

## What JSONCodec already does (read before adding a "helper")

Before writing a custom decode helper, check whether `codec/2` already covers it. Read `h(JSONCodec)` and `h(JSONCodec.codec/2)` from eval first:

- **Field aliases** — `codec :not_found, as: "not_found"` (camelCase auto-mapping via `use JSONCodec, case: :camel`).
- **Atom policy** — `codec :status, atom: :existing` or `atom: :unsafe` (explicit, never implicit `String.to_atom`).
- **Transforms** — `codec :rotate, transform: :normalize_rotate` (local atom) or `transform: &Mod.fun/1` (remote capture).
- **Computed fields** — `computed :id, fn struct -> ... end` (derived, not decoded).
- **Nested structs** — declared as `OtherMod.t()` in `@type t`; `JSONCodec` recurses.
- **Map value callbacks** — `codec :icons, values: :icon_value` / `decode_values: :decode_icon` / `values_source: :icon_defaults` for map-heavy fields.
- **Schema export** — `MyMod.schema()` / `JSONCodec.schema(MyMod)` returns a JSON Schema-compatible map.

`use JSONCodec, fast_path: :json` generates an optimized first `from_map!` clause for normal Jason-decoded string-keyed maps, with a generic fallback. `use JSONCodec, case: :camel` auto-maps atom keys to camelCase JSON keys.

## Encode: Jason.Encoder, not hand-rolled `to_map` + `Jason.encode!`

To serialize a struct to JSON, derive or implement the `Jason.Encoder` protocol. Never hand-roll a `to_json_map/1` followed by `Jason.encode!/1`.

Simple case — derive with field exclusion:

```elixir
defmodule MyApp.User do
  @derive {Jason.Encoder, only: [:id, :name, :email]}
  defstruct [:id, :name, :email, :password_hash]
end

Jason.encode!(%MyApp.User{id: 1, name: "Ada", email: "a@x", password_hash: "secret"})
# => "{\"id\":1,\"name\":\"Ada\",\"email\":\"a@x\"}"
```

Custom case — implement the protocol directly:

```elixir
defimpl Jason.Encoder, for: MyApp.User do
  def encode(%MyApp.User{} = user, opts) do
    Jason.Encode.map(
      %{"id" => user.id, "name" => user.name},
      opts
    )
  end
end
```

Read `h(Jason.Encoder)` and `h(Jason.Encode)` before implementing — the protocol's `encode/2` contract and the `Jason.Encode.*` helpers are the supported surface. Do not guess the helper names.

`JSONCodec.dump/1` is the codec-direction reverse: it converts a JSONCodec struct back to a JSON-shaped Elixir map **with the configured JSON field names** (camelCase etc.). Use it when you need the JSON-shaped map for something other than immediate encoding. `to_map/1` is the compatibility helper that stringifies atom keys recursively; prefer `dump/1` for codec-owned structs since it honors field aliases.

## The boundary rule (ties to `internal-contracts.md`)

JSON string keys live only at the boundary. The flow is one-directional at the edge:

```
binary JSON
  └─ Jason.decode!                # boundary: binary -> string-keyed map
       └─ JSONCodec.from_map!     # boundary: string-keyed map -> struct (the ONE normalization)
            └─ ... everything downstream takes the struct, never the string-keyed map
```

- `Jason.decode!` is the only function that produces string-keyed JSON maps in normal code.
- `JSONCodec.from_map!` is the only function that consumes them (generated, not hand-rolled).
- No second normalization, no `Map.get(map, "foo")` two functions deep, no `String.to_atom` scattered across readers. See `internal-contracts.md`.

## When hand-rolling is allowed

- One-off scripts and throwaway exploratory `elixir_eval` where defining a `use JSONCodec` struct is genuinely more code than the task. Not in `lib/`.
- Parsing JSON whose shape is not knowable in advance (a truly dynamic payload, a config dump from a foreign system) — but then the result type is a declared `%{String.t() => term()}` map, not a struct, and you say so in the `@spec`.

Everything that has a shape gets a `JSONCodec` struct. Everything else is a typed map, not an untyped `map()`.
