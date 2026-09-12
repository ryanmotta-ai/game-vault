export interface LaunchGameOptions {
  gameId: string;
  executablePath: string;
  args?: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
}

export interface LaunchResult {
  success: boolean;
  processId?: number;
  error?: string;
}
