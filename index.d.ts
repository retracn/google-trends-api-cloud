export interface TrendsOptions {
  keyword?: string | string[];
  startTime?: Date;
  endTime?: Date;
  geo?: string | string[];
  hl?: string;
  timezone?: number;
  category?: number | string;
  property?: 'images' | 'news' | 'youtube' | 'froogle' | '';
  resolution?: 'COUNTRY' | 'REGION' | 'CITY' | 'DMA';
  granularTimeResolution?: boolean;
  trendDate?: Date;
  /** dailyTrends / realTimeTrends: how many trending searches (default 25). */
  maxItems?: number;
  count?: number;
  /** Apify API token; defaults to the APIFY_TOKEN environment variable. */
  apifyToken?: string;
  [key: string]: unknown;
}
type Callback = (err: Error | null, results?: string) => void;
type Method = {
  (options: TrendsOptions): Promise<string>;
  (options: TrendsOptions, callback: Callback): void;
};
export declare const interestOverTime: Method;
export declare const interestByRegion: Method;
export declare const relatedQueries: Method;
export declare const relatedTopics: Method;
export declare const dailyTrends: Method;
export declare const realTimeTrends: Method;
export declare const autoComplete: Method;
