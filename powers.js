const ALL_SUPERPOWERS = [
    {
        id: 'chronomancers_glimpse',
        name: "Chronomancer's Glimpse",
        description: "Peer into and manipulate the currents of time.",
        baseElements: [
            {
                id: 'echo_record',
                name: "Record Timeline Echo",
                datapoint: {
                    type: 'timeline_events_v1', // WebsimSocket collection type
                    description: 'Records significant temporal events or observations.',
                    interactionPrompt: 'Record Timeline Echo',
                },
                visualEffect: {
                    prompt: 'Pixel art depiction of swirling clocks, fractal temporal distortions, and glowing hour glasses, dark cosmic background.',
                    trigger: 'on_interaction', // 'on_data_change' or 'on_interaction'
                }
            }
        ],
        potentialEvolutions: [
            {
                name: "Temporal Stutter",
                datapoint: { type: 'time_loops_v1', description: 'Short, localized time loops or replays.', interactionPrompt: 'Create Micro-Loop' },
                visualEffect: { prompt: 'Pixel art of a scene rapidly flickering and repeating, ghosting images, intense blue and purple light.', trigger: 'on_interaction' }
            },
            {
                name: "Precognitive Flash",
                datapoint: { type: 'future_visions_v1', description: 'Brief, vivid glimpses of possible futures.', interactionPrompt: 'Seek Future Glimpse' },
                visualEffect: { prompt: 'Pixel art of a hazy, shimmering vision overlaying reality, bright white and gold particles.', trigger: 'on_interaction' }
            }
        ]
    },
    {
        id: 'terra_shaper',
        name: "Terra Shaper",
        description: "Command the very earth beneath, raising mountains or carving canyons.",
        baseElements: [
            {
                id: 'earth_shift',
                name: "Shift Earthen Mass",
                datapoint: {
                    type: 'earth_manipulations_v1',
                    description: 'Records instances of significant earth movement or shaping.',
                    interactionPrompt: 'Shift Earthen Mass',
                },
                visualEffect: {
                    prompt: 'Pixel art of jagged rocks and earth erupting from the ground, forming dynamic structures, dust clouds, brown and grey tones.',
                    trigger: 'on_interaction',
                }
            }
        ],
        potentialEvolutions: [
            {
                name: "Crystal Growth",
                datapoint: { type: 'crystal_formations_v1', description: 'Cultivate and grow resonant crystals.', interactionPrompt: 'Grow Crystal Cluster' },
                visualEffect: { prompt: 'Pixel art of vibrant, glowing crystals sprouting from the earth, geometric patterns, pulsating light.', trigger: 'on_interaction' }
            },
            {
                name: "Seismic Pulse",
                datapoint: { type: 'seismic_events_v1', description: 'Unleash localized tremors.', interactionPrompt: 'Generate Seismic Pulse' },
                visualEffect: { prompt: 'Pixel art of shockwaves rippling through the ground, cracks appearing, objects shaking violently.', trigger: 'on_interaction' }
            }
        ]
    },
    {
        id: 'data_weaver',
        name: "Data Weaver",
        description: "Navigate and manipulate the endless streams of information.",
        baseElements: [
            {
                id: 'stream_tap',
                name: "Tap into Data Stream",
                datapoint: {
                    type: 'data_streams_v1',
                    description: 'Monitors or injects information into digital or conceptual data flows.',
                    interactionPrompt: 'Tap Data Stream',
                },
                visualEffect: {
                    prompt: 'Pixel art of glowing blue and green digital lines, nodes, and packets forming a complex network, abstract data patterns.',
                    trigger: 'on_interaction',
                }
            }
        ],
        potentialEvolutions: [
            {
                name: "Information Siphon",
                datapoint: { type: 'knowledge_extraction_v1', description: 'Extract specific knowledge from data streams.', interactionPrompt: 'Siphon Knowledge' },
                visualEffect: { prompt: 'Pixel art of specific data fragments being pulled into a central glowing orb, bright streams of light.', trigger: 'on_interaction' }
            },
            {
                name: "Digital Decoy",
                datapoint: { type: 'decoy_programs_v1', description: 'Create illusory data constructs.', interactionPrompt: 'Launch Digital Decoy' },
                visualEffect: { prompt: 'Pixel art of glitching, holographic figures made of data, shimmering and distorting.', trigger: 'on_interaction' }
            }
        ]
    },
    {
        id: 'empaths_aura',
        name: "Empath's Aura",
        description: "Sense and influence the emotional states of beings and environments.",
        baseElements: [
            {
                id: 'emotion_sense',
                name: "Sense Emotional Resonance",
                datapoint: {
                    type: 'emotional_imprints_v1',
                    description: 'Detects and records strong emotional signatures or residues.',
                    interactionPrompt: 'Sense Emotional Resonance',
                },
                visualEffect: {
                    prompt: 'Pixel art of soft, shifting colorful auras (pinks, light blues, yellows), gentle light particles, ethereal glow.',
                    trigger: 'on_interaction',
                }
            }
        ],
        potentialEvolutions: [
            {
                name: "Emotional Projection",
                datapoint: { type: 'emotion_broadcast_v1', description: 'Project a specific emotional state outwards.', interactionPrompt: 'Project Calmness' },
                visualEffect: { prompt: 'Pixel art of waves of calming blue light emanating from a central point, soothing particles.', trigger: 'on_interaction' }
            },
            {
                name: "Empathic Link",
                datapoint: { type: 'shared_feelings_v1', description: 'Temporarily link emotional states with another.', interactionPrompt: 'Form Empathic Link' },
                visualEffect: { prompt: 'Pixel art of two figures connected by a glowing cord of light, intermingling auras.', trigger: 'on_interaction' }
            }
        ]
    }
];

window.ALL_SUPERPOWERS = ALL_SUPERPOWERS;

