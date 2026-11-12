import next from "eslint-config-next";

const config = [...next, { ignores: [".next/**", "out/**", "node_modules/**"] }];
export default config;
