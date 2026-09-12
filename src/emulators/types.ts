import { GamePlatform } from '../core/types';

export interface LaunchEmulatorOptions {
  emulatorId: string;
  romPath: string;
  customArgs?: string[];
}

export interface EmulatorDetectionResult {
  detected: boolean;
  platform: GamePlatform;
  name: string;
  detectedPath?: string;
}
