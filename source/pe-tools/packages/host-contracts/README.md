# @pe/host-contracts

Generated and TS-owned Host contract surfaces used by the TypeScript Effect host,
web app, and Pea tools.

Use the package subpaths:

- `@pe/host-contracts/contracts` for generated operation metadata, bridge
  protocol constants/schemas, and product constants.
- `@pe/host-contracts/effect` for generated Effect Schema DTOs, inferred types,
  and enum value constants.
- `@pe/host-contracts/effect/registry` for generated bridge operation schema
  lookup.
- `@pe/host-contracts/operation-types` for TS-owned admin/local operation
  request/response types and generic key/request/response maps.
- `@pe/host-contracts/rpc` for the contract-only Effect RPC group.

## Development

- Install dependencies:

```bash
vp install
```

- Run the unit tests:

```bash
vp test
```

- Build the library:

```bash
vp pack
```
