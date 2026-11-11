terraform {
  required_version = ">= 1.9"

  required_providers {
    flux = {
      source  = "fluxcd/flux"
      version = "~> 1.10"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.4"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 3.5"
    }
  }
}
