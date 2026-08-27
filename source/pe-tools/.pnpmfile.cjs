module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name !== "@ai-sdk/ui-utils" || pkg.version !== "1.2.11") return pkg;
      const { zod: _zod, ...peerDependencies } = pkg.peerDependencies;
      return {
        ...pkg,
        dependencies: { ...pkg.dependencies, zod: "3.25.76" },
        peerDependencies,
      };
    },
  },
};
