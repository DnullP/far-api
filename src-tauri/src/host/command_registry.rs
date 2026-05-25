use crate::backend_module_manifest::builtin_backend_module_contributions;
use crate::commands::{COLLECTION_COMMAND_IDS, ENVIRONMENT_COMMAND_IDS, REQUEST_COMMAND_IDS};
use crate::config_history::{CONFIG_COMMAND_IDS, HISTORY_COMMAND_IDS};
use crate::host::commands::frontend_log_commands::FRONTEND_LOG_COMMAND_IDS;
use crate::host::commands::http_commands::HTTP_COMMAND_IDS;
use crate::module_contribution::collect_contributed_command_ids;
use std::collections::BTreeSet;

pub fn registered_command_ids() -> BTreeSet<&'static str> {
    [
        FRONTEND_LOG_COMMAND_IDS,
        HTTP_COMMAND_IDS,
        COLLECTION_COMMAND_IDS,
        REQUEST_COMMAND_IDS,
        ENVIRONMENT_COMMAND_IDS,
        CONFIG_COMMAND_IDS,
        HISTORY_COMMAND_IDS,
    ]
    .into_iter()
    .flat_map(|group| group.iter().copied())
    .collect()
}

pub fn validate_registered_commands() -> Result<(), String> {
    let registered = registered_command_ids();
    let contributed = collect_contributed_command_ids(&builtin_backend_module_contributions());
    if registered == contributed {
        return Ok(());
    }

    let missing_from_registry: Vec<_> = contributed.difference(&registered).copied().collect();
    let missing_from_contributions: Vec<_> = registered.difference(&contributed).copied().collect();
    Err(format!(
        "command registry mismatch; missing_from_registry={:?}; missing_from_contributions={:?}",
        missing_from_registry, missing_from_contributions
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_commands_match_backend_module_contributions() {
        validate_registered_commands().unwrap();
    }
}
