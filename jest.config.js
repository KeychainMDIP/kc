const config = {
  extensionsToTreatAsEsm: [".ts"],
  preset: "ts-jest",
  transform: {
    "^.+\\.[tj]sx?$": ["ts-jest", { useESM: true }], // Enable ESM for TypeScript
    "^.+\\.js$": "babel-jest", // Transpile JavaScript
  },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "mjs", "ts"],
  testPathIgnorePatterns: ["/node_modules/", "/kc-app/", "/client/"],
  moduleNameMapper: {
    "^multiformats/(.*)$": "<rootDir>/node_modules/multiformats/dist/src/$1",
  },
  transformIgnorePatterns: ["node_modules/(?!multiformats)"],
};

export default config;
