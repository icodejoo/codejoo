declare const lint: {
    plugins: ("import" | "oxc" | "promise" | "typescript" | "unicorn")[];
    categories: {
        correctness: "error";
        suspicious: "warn";
        perf: "warn";
        style: "off";
        pedantic: "off";
    };
    rules: {
        "no-unused-vars": "off";
        "typescript/no-unused-vars": "off";
        "no-undef": "off";
    };
    ignorePatterns: string[];
};
export { lint };
declare const _default: {
    lint: {
        plugins: ("import" | "oxc" | "promise" | "typescript" | "unicorn")[];
        categories: {
            correctness: "error";
            suspicious: "warn";
            perf: "warn";
            style: "off";
            pedantic: "off";
        };
        rules: {
            "no-unused-vars": "off";
            "typescript/no-unused-vars": "off";
            "no-undef": "off";
        };
        ignorePatterns: string[];
    };
};
export default _default;
