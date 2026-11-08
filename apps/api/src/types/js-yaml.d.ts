// Minimal typing for js-yaml (used only by the serverless.yml structure test). The package ships no types in this lock file.
declare module 'js-yaml' {
  export class Type {
    constructor(tag: string, opts: { kind: 'scalar' | 'sequence' | 'mapping'; construct: (data: unknown) => unknown });
  }
  export class Schema {
    extend(types: Type[]): Schema;
  }
  export const DEFAULT_SCHEMA: Schema;
  export function load(src: string, opts?: { schema?: Schema }): unknown;
  const yaml: { Type: typeof Type; DEFAULT_SCHEMA: Schema; load: typeof load };
  export default yaml;
}
