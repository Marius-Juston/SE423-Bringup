// The list of figures, made by tools/figure-meta.ts when the game is built or served.
declare module "virtual:figure-meta" {
  const meta: { id: string; title?: string; description?: string }[];
  export default meta;
}
