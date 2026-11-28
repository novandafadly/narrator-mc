export interface LipSyncVowels {
  aa: number;
  ih: number;
  ou: number;
  ee: number;
  oh: number;
}

export interface LipSyncAnalyzeResult {
  volume: number;
  vowels: LipSyncVowels;
}
