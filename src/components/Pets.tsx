import { useEffect, useState, useRef } from 'react';
import { motion, useAnimationFrame, useMotionValue } from 'framer-motion';
import { loadPetPack, subscribePetPack, type PetDefinition } from '../lib/petPack';

interface PetProps {
  sprite: string;
  name: string;
  initialX: number;
  initialY: number;
  speed?: number;
  spriteFilter?: string;
}

const Pet = ({ sprite, name, initialX, initialY, speed = 1, spriteFilter = 'contrast-125 saturate-150' }: PetProps) => {
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
  const [pets, setPets] = useState<PetDefinition[]>(() => loadPetPack());

  useEffect(() => {
    setDimensions({ w: window.innerWidth, h: window.innerHeight });
    const handleResize = () => setDimensions({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => subscribePetPack(() => setPets(loadPetPack())), []);

  const activePets = pets.filter((pet) => pet.enabled && pet.sprite);
  if (dimensions.w === 0 || activePets.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {activePets.map((pet, index) => {
        const slot = activePets.length === 1 ? 0.5 : index / Math.max(1, activePets.length - 1);
        return (
          <Pet
            key={pet.id}
            name={pet.name}
            sprite={pet.sprite}
            initialX={dimensions.w * (0.18 + slot * 0.64)}
            initialY={dimensions.h * (0.55 + ((index % 3) * 0.1))}
            speed={pet.speed}
            spriteFilter={pet.spriteFilter}
          />
        );
      })}
    </div>
  );
};
