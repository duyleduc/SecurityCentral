package deps

import (
	"encoding/xml"
	"fmt"
	"os"
)

type project struct {
	Dependencies struct {
		Dependency []xmlDep `xml:"dependency"`
	} `xml:"dependencies"`
}

type xmlDep struct {
	GroupID    string `xml:"groupId"`
	ArtifactID string `xml:"artifactId"`
	Version    string `xml:"version"`
	Scope      string `xml:"scope"`
}

// ParsePom parses a pom.xml file for dependencies.
func ParsePom(path string) ([]Dependency, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read pom.xml: %w", err)
	}

	var proj project
	if err := xml.Unmarshal(data, &proj); err != nil {
		return nil, fmt.Errorf("parse pom.xml: %w", err)
	}

	var result []Dependency
	for _, d := range proj.Dependencies.Dependency {
		if d.Version == "" || d.Version[0] == '$' {
			continue // skip unresolved property references
		}
		name := d.GroupID + ":" + d.ArtifactID
		result = append(result, Dependency{
			Ecosystem: "maven",
			Name:      name,
			Version:   d.Version,
			IsDirect:  d.Scope != "test",
			LockFile:  path,
		})
	}

	return result, nil
}
