

tyre_compounds_ints = {
  "SOFT": 0,
  "MEDIUM": 1,
  "HARD": 2,
  "INTERMEDIATE": 3,
  "WET": 4,
}

def get_tyre_compound_int(compound_str):
  return int(tyre_compounds_ints.get(compound_str.upper(), -1))
