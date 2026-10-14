/** Whether the host enables its Revit bridge; current connections are discovered through pe_find. */
export interface PeaRuntimeCapabilities {
  readonly revit: boolean;
}
