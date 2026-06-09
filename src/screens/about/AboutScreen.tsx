import logoUrl from '../../assets/brand/stray-circuits-horizontal-light.svg';
import styles from './AboutScreen.module.css';

interface AboutScreenProps {
  onBack: () => void;
}

interface ExternalLink {
  href: string;
  icon: string;
  label: string;
}

const LINKS: ExternalLink[] = [
  {
    href: 'https://straycircuits.com',
    icon: 'ti ti-world',
    label: 'straycircuits.com',
  },
  {
    href: 'https://straycircuits.com/about/',
    icon: 'ti ti-info-circle',
    label: 'About Stray Circuits',
  },
  {
    href: 'https://reverb.com/shop/zachs-gear-locker-98',
    icon: 'ti ti-shopping-bag',
    label: 'Shop on Reverb',
  },
  {
    href: 'https://www.instagram.com/straycircuits/',
    icon: 'ti ti-brand-instagram',
    label: '@straycircuits on Instagram',
  },
  {
    href: 'https://github.com/Stray-Circuits/rig-planner-app/issues',
    icon: 'ti ti-bug',
    label: 'Report an issue on GitHub',
  },
];

export function AboutScreen({ onBack }: AboutScreenProps) {
  return (
    <div className={styles.screen}>
      <div className={styles.fabTopLeft}>
        <button
          type="button"
          className={styles.fab}
          aria-label="Back to rigs"
          onClick={onBack}
        >
          <i className="ti ti-chevron-left" aria-hidden />
        </button>
      </div>

      <main className={styles.body}>
        <div className={styles.logoFrame}>
          <img
            className={styles.logo}
            src={logoUrl}
            alt="Stray Circuits"
            draggable={false}
          />
        </div>

        <p className={styles.tagline}>Rig Planner by Stray Circuits</p>

        <p className={styles.blurb}>
          Stray Circuits is a one-person guitar pedal shop building custom,
          cat-themed pedals out of small batch enclosures — including
          personalized ones featuring your own cat.
        </p>

        <ul className={styles.links}>
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                className={styles.linkRow}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <i className={link.icon} aria-hidden />
                <span className={styles.linkLabel}>
                  {link.label}
                  <span className={styles.linkUrl}>{link.href}</span>
                </span>
                <i
                  className={`ti ti-external-link ${styles.chevron}`}
                  aria-hidden
                />
              </a>
            </li>
          ))}
        </ul>

        <p className={styles.colophon}>
          Made with care for cats and dirty signal paths.
        </p>
      </main>
    </div>
  );
}
