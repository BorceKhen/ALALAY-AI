import os

_primary_failed = False

def get_groq_client(force_backup=False):
    """
    Returns an initialized Groq client using either the primary or backup API key.
    If the primary key is known to have failed, or if force_backup is True, it tries the backup key.
    """
    global _primary_failed
    from groq import Groq
    
    primary_key = os.environ.get("GROQ_API_KEY", "")
    backup_key = os.environ.get("GROQ_API_KEY_BACKUP", "")
    
    # Try backup key if primary is marked failed, or backup is forced
    if (force_backup or _primary_failed) and backup_key:
        return Groq(api_key=backup_key), True
        
    if primary_key:
        return Groq(api_key=primary_key), False
    elif backup_key:
        return Groq(api_key=backup_key), True
        
    raise ValueError("Neither GROQ_API_KEY nor GROQ_API_KEY_BACKUP is configured.")

def mark_primary_failed():
    """Marks the primary Groq API key as failed so subsequent calls use the backup key."""
    global _primary_failed
    _primary_failed = True
