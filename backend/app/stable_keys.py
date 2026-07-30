"""Kanonische Personen-IDs ``SA-P-<base32(8)>`` (Umsetzungsplan P4.5).

Python-Seite des Schluesselschemas. Wortgleicher Port von
``scripts/atlas-id-scheme.mjs`` (``stableKey``, ``canonicalPersonKey``,
``clusterIdForName``); die Gleichheit beider Seiten prueft
``tests/atlas-db-id-scheme.check.mjs`` gegen dieselben Testvektoren.

Beide Seiten sind wiederum ein Port der Postgres-Funktion ``sanad_stable_key``
aus ``database/schema.sql``. Diese Funktion steht dort im POSTGRES-ONLY-Block,
den ``scripts/atlas-schema-translate.mjs`` beim Uebersetzen nach SQLite
ueberspringt -- die Schluesselerzeugung muss also ausserhalb der Datenbank
stattfinden, sonst gaebe es zwei Definitionen, von denen nur eine laeuft.

Der Seed einer kanonischen Person ist eine unveraenderliche Identitaets-ID.
Eine Namensform oder ``UNC-``-ID darf erst nach einer redaktionellen
Identitaetsentscheidung als Kompatibilitaets-Seed dienen: ein Namenscluster
kann mehrere homonyme Personen enthalten.
"""

from __future__ import annotations

import hashlib
import re

from .normalize import normalize_arabic

BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

CANONICAL_PERSON_PREFIX = "SA-P-"
OCCURRENCE_CLUSTER_PREFIX = "UNC-"
RELATIVE_CLUSTER_PREFIX = "UNC-REL-"

_CANONICAL_PERSON_RE = re.compile(r"^SA-P-[A-Z2-7]{8}$")


def stable_key(prefix: str, seed: str) -> str:
    """Port von ``sanad_stable_key(prefix, seed)`` aus database/schema.sql."""
    if not isinstance(prefix, str) or not isinstance(seed, str) or not seed:
        raise TypeError("stable_key erwartet nichtleere Strings fuer prefix und seed")
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return prefix + "".join(BASE32_ALPHABET[digest[i] % 32] for i in range(8))


def is_canonical_person_key(value: object) -> bool:
    return isinstance(value, str) and bool(_CANONICAL_PERSON_RE.match(value))


def canonical_person_key(identity_seed: str, collision_index: int = 0) -> str:
    """Mintet eine SA-P-ID aus einer unveraenderlichen Identitaets-ID.

    Eine normalisierte Namensform ist kein geeigneter Seed: derselbe Name kann
    mehrere homonyme Personen bezeichnen. SA-P wird deshalb erst beim Anlegen
    einer Identitaetsentitaet vergeben, nicht beim Import eines UNC-Clusters.
    """
    if not isinstance(identity_seed, str) or not identity_seed:
        raise TypeError("identity_seed muss ein nichtleerer String sein")
    if not isinstance(collision_index, int) or isinstance(collision_index, bool) or collision_index < 0:
        raise ValueError("collision_index muss eine nichtnegative ganze Zahl sein")
    seed = f"{identity_seed}#{collision_index}" if collision_index > 0 else identity_seed
    return stable_key(CANONICAL_PERSON_PREFIX, seed)


def canonical_person_key_for_cluster(cluster_id: str | None, homonym_index: int = 0) -> str | None:
    """Kanonischer Schluessel zu einer Occurrence-Cluster-ID.

    ``None`` fuer positionsgebundene Rueckverweisformen (``UNC-REL-``): „ابيه"
    ist keine globale Person, sondern eine Aussage ueber genau eine Position in
    genau einer Kette. Eine kanonische Personen-ID dafuer zu vergeben, waere die
    Behauptung einer Identitaet, die der Text nicht hergibt.
    """
    if not isinstance(cluster_id, str) or not re.fullmatch(r"UNC-[0-9a-f]{12}", cluster_id):
        return None
    return canonical_person_key(cluster_id, homonym_index)


def cluster_id_for_name(normalized_form: str | None) -> str | None:
    """Occurrence-Cluster-ID einer beliebigen Namensform, ohne Kettenbezug."""
    # Import erst hier: repository.py importiert dieses Modul, ein Modulimport
    # in die Gegenrichtung waere ein Zyklus. Die Relativformen-Liste bleibt
    # damit trotzdem an genau einer Stelle definiert.
    from .repository import is_relative_reference

    canonical = normalize_arabic(normalized_form or "")
    if not canonical or is_relative_reference(canonical):
        return None
    return OCCURRENCE_CLUSTER_PREFIX + hashlib.sha1(canonical.encode()).hexdigest()[:12]
