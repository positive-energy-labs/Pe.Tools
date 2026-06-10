export const SearchResultTypes = ["Class", "Methods", "Properties", "Constructor"] as const;

export interface SearchResult {
  title: string;
  url: string;
  type: string;
  description?: string;
  namespace?: string;
}

export interface SearchResponseRvtDocsCom {
  current_version_results?: Array<{
    title?: string;
    description?: string;
    namespace?: string;
    type?: string;
    url?: string;
  }>;
}

export interface SearchResponseRevitApiDocsCom {
  sections?: {
    Products?: Array<{
      value: string;
      data: {
        url: string;
      };
    }>;
  };
}
