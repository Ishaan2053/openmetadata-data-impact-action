import { CanonicalEntity, LineageResult } from "../types";

export interface LineageProvider {
  readonly name: string;
  getDownstream(entity: CanonicalEntity, depth: number): Promise<LineageResult>;
}
