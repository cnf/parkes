"""Command modules: structured, per-command editors for App Profiles.

A "module" describes one known command (currently just satdump) as a set
of modes (e.g. satdump's live/offline/record CLI modes), each with its own
ordered list of fields. The frontend renders a form generically from this
schema -- adding a new module later means writing a new schema here, not
touching the App Profiles editor's rendering code.

Field shape (all keys except "key"/"type"/"label" are optional):
  key           -- storage key within a profile's module_fields dict
  type          -- "text" | "select" | "checkbox" | "remote_search"
  label         -- form label
  positional    -- True if this arg has no --flag and is emitted by
                   position (in field-list order) rather than by name
  flag          -- e.g. "--source" (required for non-positional fields)
  default       -- prefilled value
  default_by_profile_mode -- {"pass": ..., "standalone": ...}, overrides
                   `default` based on the *profile's* mode (not this
                   module's mode) -- used for {frequency}, which only
                   resolves for pass-mode profiles (see app_profiles.py's
                   resolve_command)
  unit          -- short suffix shown next to the input (e.g. "Hz")
  optional      -- hint text noting the field can be left blank
  options       -- for "select": list of option strings
  source_url / search_keys / value_key / display_template
                -- for "remote_search": where to fetch candidates from,
                   which of their keys to substring-match against, which
                   key to store as the value, and how to render a match
  show_if       -- {"field": key, "equals": value} -- hide this field
                   (and exclude it from the built command) unless another
                   field in the same mode currently equals that value

A mode's own fixed leading tokens (e.g. ["satdump", "live"]) go in
"prefix". The built command is: prefix + positional field values (in
field order) + "--flag value" for each other field with a non-empty
value (or just "--flag" for a checked checkbox) + whatever the user
added in the profile's module_extra_args escape hatch.
"""

_SDR_SOURCE_OPTIONS = ["{source}", "hackrf", "airspy", "rtlsdr", "sdrplay", "soapysdr"]

SATDUMP_MODULE = {
    "id": "satdump",
    "label": "satdump",
    "modes": [
        {
            "id": "live",
            "label": "Live processing",
            "prefix": ["satdump", "live"],
            "fields": [
                {
                    "key": "pipeline",
                    "label": "Pipeline",
                    "type": "remote_search",
                    "positional": True,
                    "source_url": "/api/orchestrator/satdump_pipelines",
                    "search_keys": ["name", "id", "family"],
                    "value_key": "id",
                    "display_template": "{name} ({family})",
                },
                {
                    "key": "output_dir",
                    "label": "Output directory",
                    "type": "text",
                    "positional": True,
                    # {timestamp} keeps consecutive passes/runs of the same
                    # profile from overwriting each other's output -- see
                    # resolve_command() in app_profiles.py.
                    "default": "{output_dir}/{timestamp}",
                },
                {
                    "key": "source",
                    "label": "SDR source",
                    "type": "select",
                    "flag": "--source",
                    "options": _SDR_SOURCE_OPTIONS,
                    "default": "{source}",
                },
                {
                    "key": "samplerate",
                    "label": "Sample rate",
                    "type": "text",
                    "flag": "--samplerate",
                    "unit": "SPS",
                    "default": "{samplerate}",
                },
                {
                    "key": "frequency",
                    "label": "Frequency",
                    "type": "text",
                    "flag": "--frequency",
                    "unit": "Hz",
                    "default_by_profile_mode": {"pass": "{frequency}", "standalone": ""},
                },
                {
                    "key": "gain",
                    "label": "Gain",
                    "type": "text",
                    "flag": "--gain",
                    "optional": True,
                },
                {
                    "key": "dc_block",
                    "label": "DC block",
                    "type": "checkbox",
                    "flag": "--dc_block",
                },
                {
                    "key": "iq_swap",
                    "label": "IQ swap",
                    "type": "checkbox",
                    "flag": "--iq_swap",
                },
                {
                    "key": "freq_shift",
                    "label": "Freq shift",
                    "type": "text",
                    "flag": "--freq_shift",
                    "unit": "Hz",
                    "optional": True,
                },
            ],
        },
        {
            "id": "offline",
            "label": "Offline decode",
            "prefix": ["satdump"],
            "fields": [
                {
                    "key": "pipeline",
                    "label": "Pipeline",
                    "type": "remote_search",
                    "positional": True,
                    "source_url": "/api/orchestrator/satdump_pipelines?live_only=false",
                    "search_keys": ["name", "id", "family"],
                    "value_key": "id",
                    "display_template": "{name} ({family})",
                },
                {
                    "key": "input_level",
                    "label": "Input level",
                    "type": "select",
                    "positional": True,
                    "options": ["baseband", "cadu", "frm", "soft", "products"],
                    "default": "baseband",
                },
                {
                    "key": "input_file",
                    "label": "Input file",
                    "type": "text",
                    "positional": True,
                },
                {
                    "key": "output_dir",
                    "label": "Output directory",
                    "type": "text",
                    "positional": True,
                    "default": "{output_dir}",
                },
                {
                    "key": "samplerate",
                    "label": "Sample rate",
                    "type": "text",
                    "flag": "--samplerate",
                    "optional": True,
                    "show_if": {"field": "input_level", "equals": "baseband"},
                },
                {
                    "key": "baseband_format",
                    "label": "Baseband format",
                    "type": "select",
                    "flag": "--baseband_format",
                    "options": ["", "f32", "s16", "s8", "u8"],
                    "show_if": {"field": "input_level", "equals": "baseband"},
                },
            ],
        },
        {
            "id": "record",
            "label": "Record baseband",
            "prefix": ["satdump", "record"],
            "fields": [
                {
                    "key": "output_name",
                    "label": "Output baseband name",
                    "type": "text",
                    "positional": True,
                    "default": "{output_dir}/recording_{timestamp}",
                },
                {
                    "key": "source",
                    "label": "SDR source",
                    "type": "select",
                    "flag": "--source",
                    "options": _SDR_SOURCE_OPTIONS,
                    "default": "{source}",
                },
                {
                    "key": "samplerate",
                    "label": "Sample rate",
                    "type": "text",
                    "flag": "--samplerate",
                    "default": "{samplerate}",
                },
                {
                    "key": "frequency",
                    "label": "Frequency",
                    "type": "text",
                    "flag": "--frequency",
                    "default_by_profile_mode": {"pass": "{frequency}", "standalone": ""},
                },
                {
                    "key": "baseband_format",
                    "label": "Baseband format",
                    "type": "select",
                    "flag": "--baseband_format",
                    "options": ["w16", "ziq", "s8", "s16", "f32"],
                    "default": "w16",
                },
            ],
        },
    ],
}

COMMAND_MODULES = [SATDUMP_MODULE]


def list_command_modules() -> list[dict]:
    return COMMAND_MODULES
