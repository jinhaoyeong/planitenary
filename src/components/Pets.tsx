import { useEffect, useState, useRef } from 'react';
import { motion, useAnimationFrame, useMotionValue } from 'framer-motion';

// Pixelated running sprites (Glameow for British Shorthair, Eevee for Pomeranian, Umbreon for Black Dog)
const CAT_SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/431.gif"; // Glameow (Grey cat)
const DOG_SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/133.gif"; // Eevee (Fluffy Pomeranian-like)
const BLACK_DOG_SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/197.gif"; // Umbreon (Small, cute, black dog/fox)

interface PetProps {
  sprite: string;
  name: string;
  initialX: number;
  initialY: number;
  speed?: number;
  spriteFilter?: string;
}

const Pet = ({ sprite, name, initialX, initialY, speed = 1, spriteFilter = "contrast-125 saturate-150" }: PetProps) => {
  const mx = useMotionValue(initialX);
  const my = useMotionValue(initialY);
  const [facingRight, setFacingRight] = useState(true);

  const posRef = useRef({ x: initialX, y: initialY });
  const dirRef = useRef({ dx: 1, dy: 0.2 });
  const targetRef = useRef({ x: initialX, y: initialY });

  const pickNewTarget = () => {
    const padding = 50;
    const maxX = window.innerWidth - padding * 2;
    const maxY = window.innerHeight - padding * 2;
    targetRef.current = {
      x: Math.max(padding, Math.random() * maxX),
      y: Math.max(padding, Math.random() * maxY),
    };
    const dx = targetRef.current.x - posRef.current.x;
    const dy = targetRef.current.y - posRef.current.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 0) {
      dirRef.current = { dx: dx / length, dy: dy / length };
      setFacingRight(dx > 0);
    }
  };

  useEffect(() => {
    pickNewTarget();
    const interval = setInterval(() => {
      if (Math.random() > 0.3) {
        pickNewTarget();
      } else {
        dirRef.current = {
          dx: (Math.random() - 0.5) * 2,
          dy: (Math.random() - 0.5) * 2,
        };
        setFacingRight(dirRef.current.dx > 0);
      }
    }, 4000 + Math.random() * 4000);
    return () => clearInterval(interval);
  }, []);

  // Drive MotionValues directly — zero React re-renders per frame.
  useAnimationFrame((_, delta) => {
    const moveSpeed = (speed * delta) / 16;
    posRef.current.x += dirRef.current.dx * moveSpeed;
    posRef.current.y += dirRef.current.dy * moveSpeed;

    const padding = 50;
    if (posRef.current.x < padding || posRef.current.x > window.innerWidth - padding) {
      dirRef.current.dx *= -1;
      setFacingRight(dirRef.current.dx > 0);
      posRef.current.x = Math.max(padding, Math.min(posRef.current.x, window.innerWidth - padding));
    }
    if (posRef.current.y < padding || posRef.current.y > window.innerHeight - padding) {
      dirRef.current.dy *= -1;
      posRef.current.y = Math.max(padding, Math.min(posRef.current.y, window.innerHeight - padding));
    }

    mx.set(posRef.current.x);
    my.set(posRef.current.y);
  });

  return (
    <motion.div
      className="fixed z-40 pointer-events-none will-change-transform"
      style={{ x: mx, y: my }}
      initial={{ opacity: 0, scale: 0, scaleX: 1 }}
      animate={{ opacity: 1, scale: 1, scaleX: facingRight ? -1 : 1 }}
      exit={{ opacity: 0, scale: 0 }}
    >
      <div className="relative group">
        <img
          src={sprite}
          alt={name}
          className={`w-12 h-12 md:w-16 md:h-16 object-contain filter ${spriteFilter}`}
          style={{ imageRendering: 'pixelated' }}
        />
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-lg text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--bg-elevated) 85%, transparent)',
            color: 'var(--ink)',
            transform: `translateX(-50%) scaleX(${facingRight ? -1 : 1})`,
          }}
        >
          {name}
        </div>
      </div>
    </motion.div>
  );
};

export const Pets = () => {
  const [dimensions, setDimensions] = useState({ w: 0, h: 0 });

  useEffect(() => {
    setDimensions({ w: window.innerWidth, h: window.innerHeight });
    
    const handleResize = () => setDimensions({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (dimensions.w === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      <Pet 
        name="Cat" 
        sprite={CAT_SPRITE} 
        initialX={dimensions.w * 0.2} 
        initialY={dimensions.h * 0.8} 
        speed={1.5}
        spriteFilter="contrast-125 saturate-100 grayscale-[0.2]" // Makes Glameow look more like a grey British Shorthair
      />
      <Pet 
        name="Dog" 
        sprite={DOG_SPRITE} 
        initialX={dimensions.w * 0.8} 
        initialY={dimensions.h * 0.8} 
        speed={2.0}
        spriteFilter="contrast-125 saturate-[1.1] hue-rotate-[-10deg]" // Makes Eevee look slightly more orange like a Pomeranian
      />
      <Pet 
        name="Black Puppy" 
        sprite={BLACK_DOG_SPRITE} 
        initialX={dimensions.w * 0.5} 
        initialY={dimensions.h * 0.6} 
        speed={1.8}
        spriteFilter="contrast-125 saturate-110" // Umbreon is naturally black and yellow, very cute!
      />
    </div>
  );
};
