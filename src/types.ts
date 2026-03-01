export type Persona = {
  id: string;
  name: string;
  description: string;
  personality: string;
  avatarPrompt: string;
  avatarUrl?: string;
  avatarData?: string;
  avatarFront?: string;
  avatarBack?: string;
  avatarSide?: string;
  avatarFull?: string;
  avatarHead?: string;
  referenceImages?: string[]; // Base64 strings for generation context
  voiceName?: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  voiceProperties?: string;
  voiceSampleUrl?: string;
};

export type ContentType = 
  | 'explainer_full_body' 
  | 'product_head' 
  | 'image_post_with_avatar' 
  | 'image_post_no_avatar';

export interface GenerationResult {
  type: 'image' | 'video';
  url: string;
  text?: string;
  script?: string;
  scriptSegments?: ScriptSegment[];
}

export interface ScriptSegment {
  text: string;
  type: 'avatar' | 'b-roll';
  visualDescription: string;
  cameraPosition?: string;
}

export type AspectRatio = '16:9' | '9:16' | '1:1';
export type ScriptAngle = 'educational' | 'storytelling' | 'hype' | 'professional';
