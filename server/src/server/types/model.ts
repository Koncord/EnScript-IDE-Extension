export type Type =
  | { tag: 'primitive'; name: string }
  | { tag: 'class'; name: string; base?: string }
  | { tag: 'array'; element: Type; size?: number }
  | { tag: 'generic'; name: string; args: Type[] }
  | { tag: 'auto'; inferred?: Type; source?: string }
  | { tag: 'unknown' };

