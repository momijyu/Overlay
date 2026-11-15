const links = [
  { href: "/about", label: "Overlayについて" },
  { href: "/terms", label: "利用規約" },
  { href: "/privacy", label: "プライバシーポリシー" },
];

export function SiteInfoLinks({ newTab = false }: { newTab?: boolean }) {
  return (
    <nav aria-label="サイトの案内" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
      {links.map(({ href, label }) => (
        <a key={href} href={href} className="link link-hover py-2"
          target={newTab ? "_blank" : undefined} rel={newTab ? "noopener noreferrer" : undefined}
          aria-label={newTab ? `${label}（別タブで開く）` : undefined}>{label}</a>
      ))}
    </nav>
  );
}
