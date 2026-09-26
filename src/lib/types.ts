/** Shape of what the model returns. Change this and the Zod schema in
 *  src/app/api/generate/route.ts together — they describe the same thing. */
export type Output = {
  summary: string;
  tags: string[];
  result: string;
};

export type Item = {
  id: string;
  title: string;
  input: string;
  output: Output | null;
  created_at: string;
};
