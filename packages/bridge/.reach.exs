[
  layers: [
    protocol: ["Pi.Protocol.**"],
    transport_port: ["Pi.Transport"],
    transport_adapter: ["Pi.Transport.Stdio"],
    target_runtime: ["Pi.Target.Runtime.**"]
  ],
  deps: [
    forbidden: [
      {:protocol, :transport_port},
      {:protocol, :transport_adapter},
      {:transport_port, :transport_adapter},
      {:target_runtime, :transport_port},
      {:target_runtime, :transport_adapter}
    ]
  ],
  calls: [
    forbidden: [
      {"Pi.**", "Pi.Transport.Stdio.**", except: ["Pi.Transport.Stdio"]}
    ]
  ],
  checks: [
    layer_coverage: [forbid_multiple_matches: true]
  ]
]
