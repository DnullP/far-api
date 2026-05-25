use crate::commands::{COLLECTION_COMMAND_IDS, ENVIRONMENT_COMMAND_IDS, REQUEST_COMMAND_IDS};
use crate::config_history::{CONFIG_COMMAND_IDS, HISTORY_COMMAND_IDS};
use crate::host::commands::frontend_log_commands::FRONTEND_LOG_COMMAND_IDS;
use crate::host::commands::http_commands::HTTP_COMMAND_IDS;
use crate::module_contribution::{
    validate_backend_module_contributions, BackendModuleContribution,
};

pub fn builtin_backend_module_contributions() -> Vec<BackendModuleContribution> {
    vec![
        BackendModuleContribution {
            module_id: "host-platform",
            command_ids: FRONTEND_LOG_COMMAND_IDS.to_vec(),
        },
        BackendModuleContribution {
            module_id: "api-client",
            command_ids: HTTP_COMMAND_IDS.to_vec(),
        },
        BackendModuleContribution {
            module_id: "workspace-data",
            command_ids: concat_command_ids(&[
                COLLECTION_COMMAND_IDS,
                REQUEST_COMMAND_IDS,
                ENVIRONMENT_COMMAND_IDS,
                CONFIG_COMMAND_IDS,
            ]),
        },
        BackendModuleContribution {
            module_id: "request-history",
            command_ids: HISTORY_COMMAND_IDS.to_vec(),
        },
    ]
}

pub fn validate_builtin_backend_module_contributions() -> Result<(), String> {
    validate_backend_module_contributions(&builtin_backend_module_contributions())
}

fn concat_command_ids(groups: &[&'static [&'static str]]) -> Vec<&'static str> {
    groups
        .iter()
        .flat_map(|group| group.iter().copied())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_contributions_are_valid() {
        validate_builtin_backend_module_contributions().unwrap();
    }
}
