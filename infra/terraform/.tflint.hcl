# Configuración de tflint. Instalar el plugin una vez:  tflint --init --config infra/terraform/.tflint.hcl
plugin "terraform" {
  enabled = true
  preset  = "recommended"
  version = "0.17.0"
  source  = "github.com/terraform-linters/tflint-ruleset-terraform"
}
