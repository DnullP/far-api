use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackendModuleContribution {
    pub module_id: &'static str,
    pub command_ids: Vec<&'static str>,
}

pub fn validate_backend_module_contributions(
    contributions: &[BackendModuleContribution],
) -> Result<(), String> {
    let mut module_ids = BTreeSet::new();
    let mut command_ids = BTreeSet::new();

    for contribution in contributions {
        if contribution.module_id.trim().is_empty() {
            return Err("backend module contribution has an empty module_id".to_string());
        }
        if !module_ids.insert(contribution.module_id) {
            return Err(format!(
                "duplicate backend module contribution id '{}'",
                contribution.module_id
            ));
        }

        for command_id in &contribution.command_ids {
            if command_id.trim().is_empty() {
                return Err(format!(
                    "backend module '{}' declares an empty command id",
                    contribution.module_id
                ));
            }
            if !command_ids.insert(*command_id) {
                return Err(format!(
                    "duplicate backend command id '{}' in module contributions",
                    command_id
                ));
            }
        }
    }

    Ok(())
}

pub fn collect_contributed_command_ids(
    contributions: &[BackendModuleContribution],
) -> BTreeSet<&'static str> {
    contributions
        .iter()
        .flat_map(|contribution| contribution.command_ids.iter().copied())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_module_ids() {
        let contributions = vec![
            BackendModuleContribution {
                module_id: "workspace",
                command_ids: vec!["a"],
            },
            BackendModuleContribution {
                module_id: "workspace",
                command_ids: vec!["b"],
            },
        ];

        let err = validate_backend_module_contributions(&contributions).unwrap_err();
        assert!(err.contains("duplicate backend module contribution id"));
    }

    #[test]
    fn rejects_duplicate_command_ids() {
        let contributions = vec![
            BackendModuleContribution {
                module_id: "workspace",
                command_ids: vec!["same_command"],
            },
            BackendModuleContribution {
                module_id: "history",
                command_ids: vec!["same_command"],
            },
        ];

        let err = validate_backend_module_contributions(&contributions).unwrap_err();
        assert!(err.contains("duplicate backend command id"));
    }
}
