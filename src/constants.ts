import { Persona } from './types';

export const PERSONAS: Persona[] = [
  {
    id: 'arjun',
    name: 'Arjun',
    description: 'The Mumbai Tech Entrepreneur',
    personality: 'Ambitious, fast-talking, and highly optimistic. Uses Hinglish occasionally and focuses on the "next big thing" in the Indian startup ecosystem.',
    avatarPrompt: 'A photorealistic portrait of a sharp-looking Indian man in his late 20s, wearing a modern linen shirt, standing in a natural, brightly lit co-working space in Mumbai. Real human features, natural skin texture, high-resolution photography.',
    voiceName: 'Zephyr'
  },
  {
    id: 'priya',
    name: 'Priya',
    description: 'The Bangalore Software Lead',
    personality: 'Methodical, calm, and deeply technical. Speaks with precision and focuses on scalability, clean code, and work-life balance in the IT sector.',
    avatarPrompt: 'A realistic professional headshot of an Indian woman in her early 30s with glasses, wearing a smart casual blazer, in a modern tech office in Bangalore. Natural lighting from windows, authentic office environment, sharp focus on facial features.',
    voiceName: 'Kore'
  },
  {
    id: 'ananya',
    name: 'Ananya',
    description: 'The Delhi Lifestyle Influencer',
    personality: 'Vibrant, trendy, and highly social. Focuses on aesthetics, luxury, and the latest trends in Indian fashion and food.',
    avatarPrompt: 'A candid, high-quality photo of a stylish Indian woman in her mid-20s, wearing contemporary ethnic fusion wear, in a real chic cafe in Delhi. Natural daylight, realistic skin tones, authentic background blur.',
    voiceName: 'Puck'
  },
  {
    id: 'rajesh',
    name: 'Rajesh',
    description: 'The Chennai Finance Expert',
    personality: 'Traditional, disciplined, and data-driven. Focuses on long-term investments, stability, and conservative growth strategies.',
    avatarPrompt: 'A professional, realistic portrait of a mature Indian man in his 50s, wearing a crisp white shirt, in a traditional study room in Chennai. Soft natural morning light, detailed facial features, authentic home office setting.',
    voiceName: 'Fenrir'
  },
  {
    id: 'kavita',
    name: 'Kavita',
    description: 'The Jaipur Heritage Architect',
    personality: 'Cultured, thoughtful, and detail-oriented. Focuses on the blend of traditional Indian craftsmanship with modern sustainable design.',
    avatarPrompt: 'A photorealistic image of a refined Indian woman in her 40s, wearing a handloom saree, standing in a real restored haveli courtyard in Jaipur. Natural earthy tones, realistic textures, soft outdoor lighting.',
    voiceName: 'Charon'
  }
];

export const CONTENT_TYPES = [
  {
    id: 'explainer_full_body',
    label: 'Explainer (Full Body Video)',
    description: 'A comprehensive video explainer featuring the avatar in a full-body presentation.',
    category: 'video'
  },
  {
    id: 'product_head',
    label: 'Product Explainer (Head Only Video)',
    description: 'A focused video presentation with the avatar speaking directly to the camera.',
    category: 'video'
  },
  {
    id: 'image_post_with_avatar',
    label: 'Image Post (With Avatar)',
    description: 'A high-quality social media image featuring the avatar.',
    category: 'image'
  },
  {
    id: 'image_post_no_avatar',
    label: 'Image Post (No Avatar)',
    description: 'A high-quality social media image focused solely on the topic.',
    category: 'image'
  }
];
