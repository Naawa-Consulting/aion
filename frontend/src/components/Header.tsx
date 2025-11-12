"use client";

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const NavLink = ({ href, label }: { href: string; label: string }) => {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href === '/' ? '' : href);
  const base = 'px-2 py-1 rounded hover:text-blue-700';
  const cls = active ? 'text-blue-700 font-semibold' : 'text-gray-600';
  return <a href={href} className={`${base} ${cls}`}>{label}</a>;
};

export default function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-50 border-b backdrop-blur bg-white/80 transition-all ${scrolled ? 'py-2' : 'py-3'}`}>
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
        <h1 className={`transition-all ${scrolled ? 'text-xl' : 'text-2xl'} font-semibold`}>Aion</h1>
        <nav className="space-x-2">
          <NavLink href="/upload" label="Upload" />
          <NavLink href="/transform" label="Transform" />
          <NavLink href="/modeling" label="Modeling" />
          <NavLink href="/analysis" label="Analysis" />
          <NavLink href="/predict" label="Predict" />
        </nav>
      </div>
    </header>
  );
}

